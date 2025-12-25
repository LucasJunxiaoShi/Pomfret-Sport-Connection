const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { google } = require('googleapis');

admin.initializeApp();

// Helper function to get OAuth2 client for a user
async function getOAuth2Client(userName) {
  try {
    const db = admin.firestore();
    const nameLower = userName.toLowerCase().trim();
    const userDoc = await db.collection('users').doc(nameLower).get();
    
    if (!userDoc.exists) {
      throw new Error(`User ${userName} not found`);
    }
    
    const userData = userDoc.data();
    const refreshToken = userData.googleRefreshToken;
    const accessToken = userData.googleAccessToken;
    const tokenExpiry = userData.googleTokenExpiry;
    
    // If no refresh token, try to use access token (will expire but allows initial setup)
    if (!refreshToken && !accessToken) {
      throw new Error(`No tokens available for user ${userName}`);
    }
    
    // If only access token (no refresh token), we can still use it but it will expire
    if (!refreshToken) {
      console.warn(`No refresh token for user ${userName} - access token will expire`);
    }
    
    const oauth2Client = new google.auth.OAuth2(
      functions.config().google.client_id,
      functions.config().google.client_secret,
      functions.config().google.redirect_uri
    );
    
    oauth2Client.setCredentials({
      refresh_token: refreshToken,
      access_token: accessToken,
      expiry_date: tokenExpiry,
    });
    
    // Refresh token if needed (only if refresh token exists)
    if (refreshToken && (!accessToken || (tokenExpiry && Date.now() >= tokenExpiry))) {
      try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        
        // Update stored tokens
        await db.collection('users').doc(nameLower).update({
          googleAccessToken: credentials.access_token,
          googleTokenExpiry: credentials.expiry_date,
        });
        
        oauth2Client.setCredentials(credentials);
      } catch (error) {
        console.error(`Failed to refresh token for ${userName}:`, error);
        // Continue with existing token if refresh fails
      }
    }
    
    return oauth2Client;
  } catch (error) {
    console.error(`Error getting OAuth2 client for ${userName}:`, error);
    throw error;
  }
}

// Create calendar event for a user
async function createCalendarEventForUser(userName, eventData) {
  try {
    const oauth2Client = await getOAuth2Client(userName);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    const calendarEvent = {
      summary: eventData.summary,
      description: eventData.description,
      location: eventData.location,
      start: {
        dateTime: eventData.startDateTime,
        timeZone: eventData.timeZone,
      },
      end: {
        dateTime: eventData.endDateTime,
        timeZone: eventData.timeZone,
      },
    };
    
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: calendarEvent,
    });
    
    return response.data.id;
  } catch (error) {
    console.error(`Error creating calendar event for ${userName}:`, error);
    throw error;
  }
}

// Update calendar event for a user
async function updateCalendarEventForUser(userName, calendarEventId, eventData) {
  try {
    const oauth2Client = await getOAuth2Client(userName);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    // First get the existing event
    const existingEvent = await calendar.events.get({
      calendarId: 'primary',
      eventId: calendarEventId,
    });
    
    const updatedEvent = {
      ...existingEvent.data,
      summary: eventData.summary,
      description: eventData.description,
      location: eventData.location,
      start: {
        dateTime: eventData.startDateTime,
        timeZone: eventData.timeZone,
      },
      end: {
        dateTime: eventData.endDateTime,
        timeZone: eventData.timeZone,
      },
    };
    
    const response = await calendar.events.update({
      calendarId: 'primary',
      eventId: calendarEventId,
      resource: updatedEvent,
    });
    
    return response.data.id;
  } catch (error) {
    console.error(`Error updating calendar event for ${userName}:`, error);
    throw error;
  }
}

// Delete calendar event for a user
async function deleteCalendarEventForUser(userName, calendarEventId) {
  try {
    const oauth2Client = await getOAuth2Client(userName);
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: calendarEventId,
    });
    
    return true;
  } catch (error) {
    console.error(`Error deleting calendar event for ${userName}:`, error);
    // Don't throw - event might not exist in user's calendar
    return false;
  }
}

// HTTP Cloud Function: Create calendar events for all participants
exports.createCalendarEvents = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  const { eventData, participants } = data;
  
  if (!eventData || !participants || !Array.isArray(participants)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid event data or participants');
  }
  
  const results = {};
  
  // Create calendar events for all participants
  for (const participant of participants) {
    try {
      const calendarEventId = await createCalendarEventForUser(participant, eventData);
      results[participant.toLowerCase()] = calendarEventId;
    } catch (error) {
      console.error(`Failed to create calendar event for ${participant}:`, error);
      results[participant.toLowerCase()] = null;
    }
  }
  
  return { calendarEventIds: results };
});

// HTTP Cloud Function: Update calendar events for all participants
exports.updateCalendarEvents = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  const { eventData, calendarEventIds } = data;
  
  if (!eventData || !calendarEventIds) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid event data or calendar event IDs');
  }
  
  const results = {};
  
  // Update calendar events for all participants who have calendar event IDs
  for (const [participant, calendarEventId] of Object.entries(calendarEventIds)) {
    if (calendarEventId) {
      try {
        await updateCalendarEventForUser(participant, calendarEventId, eventData);
        results[participant] = true;
      } catch (error) {
        console.error(`Failed to update calendar event for ${participant}:`, error);
        results[participant] = false;
      }
    }
  }
  
  return { results };
});

// HTTP Cloud Function: Delete calendar events for all participants
exports.deleteCalendarEvents = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  const { calendarEventIds } = data;
  
  if (!calendarEventIds || typeof calendarEventIds !== 'object') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid calendar event IDs');
  }
  
  const results = {};
  
  // Delete calendar events for all participants
  for (const [participant, calendarEventId] of Object.entries(calendarEventIds)) {
    if (calendarEventId) {
      try {
        await deleteCalendarEventForUser(participant, calendarEventId);
        results[participant] = true;
      } catch (error) {
        console.error(`Failed to delete calendar event for ${participant}:`, error);
        results[participant] = false;
      }
    }
  }
  
  return { results };
});

// HTTP Cloud Function: Store user's Google OAuth tokens
exports.storeUserTokens = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
  }
  
  const { userName, accessToken, refreshToken, expiryDate } = data;
  
  if (!userName || !accessToken) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing required token data (userName and accessToken required)');
  }
  
  // Refresh token is optional - access token will work but expires
  // Users will need to re-authenticate when token expires if no refresh token
  
  try {
    const db = admin.firestore();
    const nameLower = userName.toLowerCase().trim();
    
    await db.collection('users').doc(nameLower).update({
      googleAccessToken: accessToken,
      googleRefreshToken: refreshToken || null,
      googleTokenExpiry: expiryDate || null,
    });
    
    return { success: true };
  } catch (error) {
    console.error('Error storing user tokens:', error);
    throw new functions.https.HttpsError('internal', 'Failed to store tokens');
  }
});

