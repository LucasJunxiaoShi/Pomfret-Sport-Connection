const { useState, useEffect } = React;

const SPORTS = [
  {
    id: 'billiards',
    name: 'Billiards',
    tagline: 'Sink balls, talk trash, repeat.',
    locationHint: 'OSU, at the pool tables',
  },
  {
    id: 'soccer',
    name: 'Soccer',
    tagline: 'Run around, kick stuff, pretend you\'re Messi.',
    locationHint: 'Fields or turf',
  },
  {
    id: 'basketball',
    name: 'Basketball',
    tagline: 'Hoops, handles, and questionable calls.',
    locationHint: 'Lewis Gymnasium',
  },
  {
    id: 'squash',
    name: 'Squash',
    tagline: 'Tiny room, big swings, zero chill.',
    locationHint: 'OSU squash courts',
  },
  {
    id: 'pingpong',
    name: 'Ping Pong',
    tagline: 'Spinning serves, epic rallies.',
    locationHint: 'OSU Ping Pong table',
  },
];

// Firebase Firestore helpers
// Requires firebase to be initialized globally in index.html
// with firebase-app-compat and firebase-firestore-compat scripts.

async function loadEventsFromFirebase() {
  try {
    const db = firebase.firestore();
    const docRef = db.collection('appState').doc('events');
    const snap = await docRef.get();
    if (!snap.exists) return {};
    const data = snap.data();
    return typeof data.eventsBySport === 'object' && data.eventsBySport !== null
      ? data.eventsBySport
      : {};
  } catch (e) {
    console.error('Failed to load events from Firebase', e);
    return {};
  }
}

function cleanExpiredEvents(eventsBySport) {
  try {
    const now = Date.now();
    let changed = false;
    const cleaned = {};

    Object.keys(eventsBySport || {}).forEach((sportId) => {
      const events = Array.isArray(eventsBySport[sportId])
        ? eventsBySport[sportId]
        : [];

      const filtered = events.filter((event) => {
        if (!event || !event.timeRaw) return true;
        const ts = Date.parse(event.timeRaw);
        if (Number.isNaN(ts)) return true;
        return ts >= now;
      });

      if (filtered.length !== events.length) {
        changed = true;
      }

      if (filtered.length > 0) {
        cleaned[sportId] = filtered;
      }
    });

    return { eventsBySport: changed ? cleaned : eventsBySport, changed };
  } catch (e) {
    console.error('Error cleaning expired events', e);
    return { eventsBySport, changed: false };
  }
}

async function saveEventsToFirebase(eventsBySport) {
  try {
    const db = firebase.firestore();
    const docRef = db.collection('appState').doc('events');
    await docRef.set({ eventsBySport });
  } catch (e) {
    console.error('Failed to save events to Firebase', e);
  }
}
//Google Sign-in errors display
async function signInWithGoogle() {
  try {
    const auth = firebase.auth();
    const provider = new firebase.auth.GoogleAuthProvider();
    // Request calendar scope for adding events
    provider.addScope('https://www.googleapis.com/auth/calendar');
    provider.addScope('https://www.googleapis.com/auth/calendar.events');
    const result = await auth.signInWithPopup(provider);
    const user = result.user;
    if (!user) {
      throw new Error('No user returned from Google sign-in');
    }

    const profileName = (user.displayName || '').trim();
    if (!profileName) {
      throw new Error('Google account has no display name');
    }

    // Store OAuth tokens for server-side calendar management
    const credential = result.credential;
    if (credential && credential.accessToken) {
      try {
        if (!firebase.functions) {
          console.warn('Firebase Functions not available. Tokens cannot be stored.');
          return profileName;
        }
        const functions = firebase.functions();
        const storeTokens = functions.httpsCallable('storeUserTokens');
        const tokenResult = await storeTokens({
          userName: profileName,
          accessToken: credential.accessToken,
          refreshToken: credential.refreshToken || null,
          expiryDate: credential.expirationTime || null,
        });
        console.log('Tokens stored successfully for:', profileName, tokenResult.data);
      } catch (e) {
        console.error('Error storing tokens (calendar may not work):', e);
        console.error('Error details:', e.message, e.code);
        
        // Check if functions are not deployed
        if (e.code === 'functions/not-found' || e.message?.includes('not found')) {
          console.warn('⚠️ Cloud Functions not deployed. Calendar features will not work until functions are deployed.');
        }
        // Continue even if token storage fails
      }
    } else {
      console.warn('No access token available from Google sign-in. Calendar features may not work.');
    }

    return profileName;
  } catch (e) {
    console.error('Google sign-in failed', e);
    throw e;
  }
}


// Google Calendar integration - automatically adds events via Cloud Functions
async function addEventToGoogleCalendarForAllParticipants(event, sport, participants) {
  try {
    if (!participants || participants.length === 0) {
      console.log('No participants to add to calendar');
      return {};
    }

    // Format the event date - use 30 minutes duration
    const eventDate = new Date(event.timeRaw);
    const eventEndDate = new Date(eventDate);
    eventEndDate.setMinutes(eventEndDate.getMinutes() + 30);

    const participantsList = event.participants && event.participants.length > 0
      ? `\nParticipants: ${event.participants.join(', ')}`
      : '';

    const eventData = {
      summary: `${sport.name} - ${event.hostName}`,
      description: `Pomfret Sports Connect - ${sport.name} game\nHost: ${event.hostName}\nLocation: ${event.location}${participantsList}`,
      location: event.location,
      startDateTime: eventDate.toISOString(),
      endDateTime: eventEndDate.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    console.log('Attempting to create calendar events for participants:', participants);
    
    // Call Cloud Function to automatically create calendar events for all participants
    if (!firebase.functions) {
      throw new Error('Firebase Functions not available. Make sure firebase-functions-compat.js is loaded.');
    }
    const functions = firebase.functions();
    const createCalendarEvents = functions.httpsCallable('createCalendarEvents');
    
    const result = await createCalendarEvents({
      eventData,
      participants,
    });

    console.log('Calendar events creation result:', result.data);
    const calendarEventIds = result.data.calendarEventIds || {};
    
    // Log which participants got calendar events created
    const successful = Object.entries(calendarEventIds).filter(([_, id]) => id !== null);
    const failed = Object.entries(calendarEventIds).filter(([_, id]) => id === null);
    
    if (successful.length > 0) {
      console.log(`Successfully created calendar events for: ${successful.map(([name]) => name).join(', ')}`);
    }
    if (failed.length > 0) {
      console.warn(`Failed to create calendar events for: ${failed.map(([name]) => name).join(', ')}`);
      console.warn('These participants may need to sign in first to store their Google Calendar tokens.');
    }

    return calendarEventIds;
  } catch (e) {
    console.error('Error automatically adding events to Google Calendar:', e);
    console.error('Error details:', e.message, e.code, e.details);
    
    // Check if it's a functions not deployed error
    if (e.code === 'functions/not-found' || e.message?.includes('not found')) {
      console.error('⚠️ Cloud Functions not deployed! Please deploy functions first: firebase deploy --only functions');
      console.error('Calendar features will not work until Cloud Functions are deployed.');
    }
    
    return {};
  }
}

// Update calendar events for all participants
async function updateCalendarEventsForAllParticipants(event, sport, calendarEventIds) {
  try {
    if (!calendarEventIds || Object.keys(calendarEventIds).length === 0) {
      return false;
    }

    const eventDate = new Date(event.timeRaw);
    const eventEndDate = new Date(eventDate);
    eventEndDate.setMinutes(eventEndDate.getMinutes() + 30);

    const participantsList = event.participants && event.participants.length > 0
      ? `\nParticipants: ${event.participants.join(', ')}`
      : '';

    const eventData = {
      summary: `${sport.name} - ${event.hostName}`,
      description: `Pomfret Sports Connect - ${sport.name} game\nHost: ${event.hostName}\nLocation: ${event.location}${participantsList}`,
      location: event.location,
      startDateTime: eventDate.toISOString(),
      endDateTime: eventEndDate.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };

    if (!firebase.functions) {
      console.error('Firebase Functions not available');
      return false;
    }
    const functions = firebase.functions();
    const updateCalendarEvents = functions.httpsCallable('updateCalendarEvents');
    
    await updateCalendarEvents({
      eventData,
      calendarEventIds,
    });

    return true;
  } catch (e) {
    console.error('Error updating calendar events', e);
    return false;
  }
}

// Delete calendar events for all participants
async function deleteCalendarEventsForAllParticipants(calendarEventIds) {
  try {
    if (!calendarEventIds || Object.keys(calendarEventIds).length === 0) {
      return false;
    }

    if (!firebase.functions) {
      console.error('Firebase Functions not available');
      return false;
    }
    const functions = firebase.functions();
    const deleteCalendarEvents = functions.httpsCallable('deleteCalendarEvents');
    
    await deleteCalendarEvents({
      calendarEventIds,
    });

    return true;
  } catch (e) {
    console.error('Error deleting calendar events', e);
    return false;
  }
}

// Delete calendar event for a single user
async function deleteCalendarEventForUser(userName, calendarEventId) {
  try {
    if (!calendarEventId) return false;

    if (!firebase.functions) {
      console.error('Firebase Functions not available');
      return false;
    }
    const functions = firebase.functions();
    const deleteCalendarEvents = functions.httpsCallable('deleteCalendarEvents');
    
    await deleteCalendarEvents({
      calendarEventIds: { [userName.toLowerCase()]: calendarEventId },
    });

    return true;
  } catch (e) {
    console.error('Error deleting calendar event for user', e);
    return false;
  }
}

// Check if event just became confirmed and automatically add to all participants' calendars
async function checkAndAddToCalendar(prevEvents, updatedEvents, sport, userName, onUpdateEvent) {
  try {
    if (!userName) return;
    
    const sportIdsToCheck = sport 
      ? [sport.id] 
      : Object.keys(updatedEvents);

    for (const sportId of sportIdsToCheck) {
      const sportData = sport || SPORTS.find((s) => s.id === sportId);
      if (!sportData) continue;

      const prevSportEvents = prevEvents[sportId] || [];
      const updatedSportEvents = updatedEvents[sportId] || [];

      for (const updatedEvent of updatedSportEvents) {
        if (!updatedEvent || !updatedEvent.timeRaw) continue;

        const prevEvent = prevSportEvents.find((e) => e.id === updatedEvent.id);
        const wasConfirmed = prevEvent
          ? (prevEvent.participants?.length || 0) >= (prevEvent.minPlayers || 1)
          : false;
        const isNowConfirmed =
          (updatedEvent.participants?.length || 0) >= (updatedEvent.minPlayers || 1);

        // Check if participants changed
        const prevParticipants = prevEvent?.participants || [];
        const currentParticipants = updatedEvent.participants || [];
        const participantsChanged = JSON.stringify(prevParticipants.sort()) !== JSON.stringify(currentParticipants.sort());

        // If event just became confirmed, automatically create calendar events for ALL participants
        if (!wasConfirmed && isNowConfirmed) {
          try {
            const allParticipants = [
              updatedEvent.hostName,
              ...(updatedEvent.participants || [])
            ].filter(Boolean);

            console.log(`Event "${updatedEvent.id}" just became confirmed. Creating calendar events for:`, allParticipants);

            const calendarEventIds = await addEventToGoogleCalendarForAllParticipants(
              updatedEvent,
              sportData,
              allParticipants
            );

            console.log('Calendar event IDs returned:', calendarEventIds);

            if (Object.keys(calendarEventIds).length > 0 && onUpdateEvent) {
              onUpdateEvent(sportId, updatedEvent.id, { calendarEventIds });
              
              // Show success/failure message to current user
              const userLower = (userName || '').trim().toLowerCase();
              const isInvolved = allParticipants.some(p => (p || '').trim().toLowerCase() === userLower);
              
              if (isInvolved) {
                const successCount = Object.values(calendarEventIds).filter(id => id !== null).length;
                const failCount = Object.values(calendarEventIds).filter(id => id === null).length;
                const totalCount = allParticipants.length;
                
                if (successCount === totalCount) {
                  console.log(`✅ Calendar events successfully created for all ${totalCount} participant(s)`);
                } else if (successCount > 0) {
                  console.warn(`⚠️ Calendar events created for ${successCount}/${totalCount} participants`);
                  console.warn('Some participants may need to sign in first to enable calendar features.');
                  
                  // Log failed participants
                  const failedParticipants = allParticipants.filter(p => {
                    const pLower = (p || '').trim().toLowerCase();
                    return calendarEventIds[pLower] === null;
                  });
                  
                  if (failedParticipants.length > 0) {
                    console.warn(`Failed to create calendar events for: ${failedParticipants.join(', ')}`);
                    console.warn('These participants may need to sign in first to enable calendar features.');
                  }
                } else {
                  console.error('❌ Failed to create calendar events for any participants');
                  console.error('Possible reasons:');
                  console.error('• Cloud Functions not deployed');
                  console.error('• Participants haven\'t signed in yet');
                  console.error('• Google Calendar API error');
                }
              }
            } else {
              console.warn('No calendar event IDs returned. This might mean:');
              console.warn('1. Cloud Functions are not deployed');
              console.warn('2. Participants have not signed in yet (no tokens stored)');
              console.warn('3. There was an error creating the events');
              
              // Log warning if current user is involved
              const userLower = (userName || '').trim().toLowerCase();
              const isInvolved = allParticipants.some(p => (p || '').trim().toLowerCase() === userLower);
              if (isInvolved) {
                console.warn('⚠️ Calendar events could not be automatically created');
                console.warn('Please ensure:');
                console.warn('1. Firebase Cloud Functions are deployed');
                console.warn('2. All participants have signed in at least once');
                console.warn('3. Check browser console for error details');
              }
            }
          } catch (e) {
            console.error('Error creating calendar events', e);
            console.error('Full error:', e.message, e.code, e.details);
          }
        }
        // If event was confirmed but is now below minimum, delete all calendar events
        else if (wasConfirmed && !isNowConfirmed && updatedEvent.calendarEventIds) {
          try {
            const calendarEventIds = updatedEvent.calendarEventIds || {};
            if (Object.keys(calendarEventIds).length > 0) {
              // Try to delete calendar events (may not work for all users due to client limitations)
              await deleteCalendarEventsForAllParticipants(calendarEventIds);
              
              // Show popup to notify users to manually cancel in Google Calendar
              const userLower = (userName || '').trim().toLowerCase();
              const hostNameLower = (updatedEvent.hostName || '').trim().toLowerCase();
              const isHost = userLower === hostNameLower;
              const isParticipant = (updatedEvent.participants || []).some(
                (p) => (p || '').trim().toLowerCase() === userLower
              );
              
              // Show notification to current user if they're involved
              if ((isHost || isParticipant) && calendarEventIds[userLower]) {
                const sportName = sportData.name;
                const eventTime = updatedEvent.timeLabel || new Date(updatedEvent.timeRaw).toLocaleString();
                window.alert(
                  `⚠️ Event Unconfirmed\n\n` +
                  `The "${sportName}" event on ${eventTime} is no longer confirmed (below minimum participants).\n\n` +
                  `Please manually cancel this event in your Google Calendar if it's still there.\n\n` +
                  `Event: ${sportName} - ${updatedEvent.hostName}\n` +
                  `Location: ${updatedEvent.location}`
                );
              }
              
              // Clear calendar event IDs from the event
              if (onUpdateEvent) {
                onUpdateEvent(sportId, updatedEvent.id, { calendarEventIds: {} });
              }
            }
          } catch (e) {
            console.error('Error deleting calendar events when event became unconfirmed', e);
          }
        }
        // If participants changed, update existing calendar events and handle users who left
        else if (isNowConfirmed && participantsChanged && updatedEvent.calendarEventIds) {
          const calendarEventIds = updatedEvent.calendarEventIds || {};
          const newParticipants = currentParticipants.filter(
            (p) => !prevParticipants.includes(p)
          );
          const leftParticipants = prevParticipants.filter(
            (p) => !currentParticipants.includes(p)
          );
          
          try {
            // Delete calendar events for users who left
            if (leftParticipants.length > 0) {
              const calendarEventIdsToDelete = {};
              leftParticipants.forEach((participant) => {
                const participantLower = (participant || '').trim().toLowerCase();
                if (calendarEventIds[participantLower]) {
                  calendarEventIdsToDelete[participantLower] = calendarEventIds[participantLower];
                }
              });
              
              if (Object.keys(calendarEventIdsToDelete).length > 0) {
                await deleteCalendarEventsForAllParticipants(calendarEventIdsToDelete);
                
                // Remove calendar event IDs for users who left
                const cleanedCalendarEventIds = { ...calendarEventIds };
                leftParticipants.forEach((participant) => {
                  const participantLower = (participant || '').trim().toLowerCase();
                  delete cleanedCalendarEventIds[participantLower];
                });
                
                if (onUpdateEvent) {
                  onUpdateEvent(sportId, updatedEvent.id, { calendarEventIds: cleanedCalendarEventIds });
                }
              }
            }
            
            // Update existing events with new participant list
            const currentCalendarEventIds = updatedEvent.calendarEventIds || {};
            // Remove IDs for users who left before updating
            const calendarEventIdsToUpdate = { ...currentCalendarEventIds };
            leftParticipants.forEach((participant) => {
              const participantLower = (participant || '').trim().toLowerCase();
              delete calendarEventIdsToUpdate[participantLower];
            });
            
            if (Object.keys(calendarEventIdsToUpdate).length > 0) {
              await updateCalendarEventsForAllParticipants(updatedEvent, sportData, calendarEventIdsToUpdate);
            }
            
            // Create events for new participants
            if (newParticipants.length > 0) {
              const newCalendarEventIds = await addEventToGoogleCalendarForAllParticipants(
                updatedEvent,
                sportData,
                newParticipants
              );
              
              if (Object.keys(newCalendarEventIds).length > 0 && onUpdateEvent) {
                const mergedIds = { ...calendarEventIdsToUpdate, ...newCalendarEventIds };
                onUpdateEvent(sportId, updatedEvent.id, { calendarEventIds: mergedIds });
              }
            }
          } catch (e) {
            console.error('Error updating calendar events', e);
          }
        }
      }
    }
  } catch (e) {
    console.error('Error checking and adding to calendar', e);
  }
}

// User profile helpers (using name as the unique ID)
function getLocalUser() {
  const name = localStorage.getItem('pomfretUserName');
  return name ? { displayName: name, odisplayNameLower: name.toLowerCase() } : null;
}

function setLocalUser(name) {
  localStorage.setItem('pomfretUserName', name);
}

function clearLocalUser() {
  localStorage.removeItem('pomfretUserName');
}

async function registerUser(displayName) {
  try {
    const db = firebase.firestore();
    const nameLower = displayName.toLowerCase().trim();
    // Use lowercase name as doc ID for easy lookup
    await db.collection('users').doc(nameLower).set(
      { displayName: displayName.trim(), displayNameLower: nameLower },
      { merge: true }
    );
    setLocalUser(displayName.trim());
    return true;
  } catch (e) {
    console.error('Failed to register user', e);
    return false;
  }
}

async function findUserByName(name) {
  try {
    const db = firebase.firestore();
    const nameLower = name.toLowerCase().trim();
    const snap = await db.collection('users').doc(nameLower).get();
    if (!snap.exists) return null;
    return { odisplayNameLower: snap.id, ...snap.data() };
  } catch (e) {
    console.error('Failed to find user', e);
    return null;
  }
}

function AppShell({ children, userName, onSignOut }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <div className="logo-mark">
              <span>PSC</span>
            </div>
            <div className="brand-text">
              <div className="brand-title">Pomfret Sports Connect</div>
              <div className="brand-subtitle">Student-led pickup and rec games</div>
            </div>
          </div>
          {userName && (
            <div className="user-info">
              <span className="user-email">{userName}</span>
              <button className="text-button sign-out-btn" onClick={onSignOut}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>
      <main className="app-main">
        <div className="app-main-inner">{children}</div>
      </main>
      <footer className="app-footer">
        <div className="app-footer-inner">
          <span>Pomfret School · Student Sports Signup</span>
          <span>Pomfret Red · Black · White</span>
        </div>
      </footer>
    </div>
  );
}

function Home({ onSelectSport, eventsBySport, userName }) {
  const scheduleItems = React.useMemo(() => {
    const items = [];
    if (!eventsBySport || typeof eventsBySport !== 'object') return items;

    const currentName = (userName || '').trim().toLowerCase();

    Object.keys(eventsBySport).forEach((sportId) => {
      const sport = SPORTS.find((s) => s.id === sportId);
      const sportName = sport ? sport.name : sportId;
      const events = Array.isArray(eventsBySport[sportId])
        ? eventsBySport[sportId]
        : [];

      events.forEach((event) => {
        if (!event || !event.timeRaw) return;
        const ts = Date.parse(event.timeRaw);
        if (Number.isNaN(ts)) return;

        // Visibility rule: show if you are the host OR you have joined
        const hostName = (event.hostName || '').trim().toLowerCase();
        const participants = Array.isArray(event.participants)
          ? event.participants
          : [];
        const isHost = currentName && hostName && hostName === currentName;
        const isParticipant = currentName
          ? participants.some(
              (p) => (p || '').trim().toLowerCase() === currentName
            )
          : false;
        if (!isHost && !isParticipant) {
          return;
        }

        const filled = participants.length;
        const minPlayers = Number.isFinite(event.minPlayers)
          ? event.minPlayers
          : 1;

        items.push({
          id: event.id,
          sportName,
          hostName: event.hostName || 'Unknown host',
          time: ts,
          timeLabel: event.timeLabel,
          filled,
          minPlayers,
          confirmed: filled >= minPlayers,
        });
      });
    });

    items.sort((a, b) => a.time - b.time);
    return items;
  }, [eventsBySport]);

  return (
    <>
      {scheduleItems.length > 0 && (
        <section className="schedule-bar">
          <div className="schedule-bar-inner">
            <div className="schedule-summary">
              <div className="schedule-title">Upcoming sessions</div>
              <div className="schedule-counts">
                <span className="schedule-pill schedule-pill-pending">
                  Pending: {
                    scheduleItems.filter((item) => !item.confirmed).length
                  }
                </span>
                <span className="schedule-pill schedule-pill-confirmed">
                  Confirmed: {
                    scheduleItems.filter((item) => item.confirmed).length
                  }
                </span>
              </div>
            </div>
            <div className="schedule-list">
              {scheduleItems.slice(0, 6).map((item) => (
                <div key={item.id} className="schedule-item">
                  <span
                    className={
                      'schedule-status ' +
                      (item.confirmed
                        ? 'schedule-status-confirmed'
                        : 'schedule-status-pending')
                    }
                  >
                    {item.confirmed ? 'Confirmed' : 'Pending'}
                  </span>
                  <span className="schedule-main">
                    {item.sportName} · {item.hostName}
                  </span>
                  <span className="schedule-meta">
                    {item.timeLabel} · {item.filled}/{item.minPlayers} joined
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="banner">
        <div className="banner-content">
          <div className="badge">
            <span className="badge-dot" />
            <span>Live on Campus</span>
          </div>
          <h1 className="banner-title">
            Pomfret <span className="banner-accent">Sports Signup</span>
          </h1>
          <p className="banner-text">
            Stop texting multiple group chats to find a game. Show up 
            and play as you want—no stress, no confusion.
          </p>
          <p className="banner-text" style={{ marginTop: '0.9rem' }}>
            Pick a sport, see who's ready to play, or start your own session. 
          </p>
        </div>
        <div className="banner-graphic">
          <div className="banner-circle one" />
          <div className="banner-circle two" />
          <div className="banner-lines">
            <span>Make your own squad</span>
          </div>
        </div>
      </section>

      <div className="section-heading-row">
        <div>
          <h2 className="section-heading">Pick your sport</h2>
          <p className="section-caption">
            Tap a sport. See who's got next. Join or start something.
          </p>
        </div>
      </div>

      <section className="sport-grid">
        {SPORTS.map((sport) => (
          <SportCard
            key={sport.id}
            sport={sport}
            onClick={() => onSelectSport(sport.id)}
          />
        ))}
      </section>
    </>
  );
}

function SportCard({ sport, onClick }) {
  return (
    <button className="sport-card" onClick={onClick}>
      <div className="sport-chip-row">
        <span className="sport-chip">Game Free</span>
        <span className="sport-chip-tag">Open play</span>
      </div>
      <div className="sport-name">{sport.name}</div>
      <div className="sport-meta">{sport.tagline}</div>
      <div className="sport-footer">
        <span className="sport-pill">Create / Join</span>
        <span className="sport-arrow">→</span>
      </div>
    </button>
  );
}

function SportPage({ sportId, eventsBySport, onBack, onUpdateEvents, userName }) {
  const sport = SPORTS.find((s) => s.id === sportId);
  const [showModal, setShowModal] = useState(false);
  const [currentUserName, setCurrentUserName] = useState(userName || '');
  const events = eventsBySport[sportId] || [];

  const handleCreateEvent = (newEvent) => {
    const updated = {
      ...eventsBySport,
      [sportId]: [...events, newEvent],
    };
    onUpdateEvents(updated);
    setShowModal(false);
  };

  // Callback to update event with calendar event IDs
  const updateEventWithCalendarIds = (eventId, calendarUpdate) => {
    const updatedSportEvents = events.map((e) => {
      if (e.id !== eventId) return e;
      return {
        ...e,
        ...calendarUpdate,
        calendarEventIds: {
          ...(e.calendarEventIds || {}),
          ...(calendarUpdate.calendarEventIds || {}),
        },
      };
    });
    const updated = { ...eventsBySport, [sportId]: updatedSportEvents };
    onUpdateEvents(updated);
  };

  const handleJoin = (eventId) => {
    const name = (currentUserName || '').trim();
    if (!name) {
      window.alert('Enter your name in the box at the top first.');
      return;
    }

    const prevEvents = { ...eventsBySport };
    const updatedSportEvents = events.map((e) => {
      if (e.id !== eventId) return e;
      // Do not allow the host to join their own session as a participant
      if (
        e.hostName &&
        name &&
        e.hostName.trim().toLowerCase() === name.trim().toLowerCase()
      ) {
        return e;
      }
      // Do not add the same participant twice
      const alreadyParticipant = Array.isArray(e.participants)
        ? e.participants.some(
            (p) => (p || '').trim().toLowerCase() === name.trim().toLowerCase()
          )
        : false;
      if (alreadyParticipant) return e;
      if (e.participants.length >= e.maxPlayers) return e;
      return {
        ...e,
        participants: [...e.participants, name],
      };
    });

    const updated = { ...eventsBySport, [sportId]: updatedSportEvents };
    // Check if this event just became confirmed and automatically add to calendars
    checkAndAddToCalendar(prevEvents, updated, sport, name, (sId, eId, calendarUpdate) => {
      if (sId === sportId && eId === eventId) {
        updateEventWithCalendarIds(eventId, calendarUpdate);
      }
    });
    onUpdateEvents(updated);
  };

  const handleDelete = async (eventId) => {
    // Find the event to be deleted
    const eventToDelete = events.find((e) => e.id === eventId);
    
    // Automatically delete calendar events for all participants
    if (eventToDelete && eventToDelete.calendarEventIds) {
      try {
        await deleteCalendarEventsForAllParticipants(eventToDelete.calendarEventIds);
      } catch (e) {
        console.error('Error deleting calendar events', e);
      }
    }

    const updatedSportEvents = events.filter((e) => e.id !== eventId);
    const updated = { ...eventsBySport, [sportId]: updatedSportEvents };
    onUpdateEvents(updated);
  };

  const handleCancelJoin = async (eventId) => {
    const name = (currentUserName || '').trim();
    if (!name) {
      window.alert('Enter your name in the box at the top first.');
      return;
    }

    // Find the event to get calendar event ID for this user
    const eventToLeave = events.find((e) => e.id === eventId);
    const userLower = name.trim().toLowerCase();
    
    // Delete calendar event for the user who is leaving
    if (eventToLeave && eventToLeave.calendarEventIds && eventToLeave.calendarEventIds[userLower]) {
      try {
        await deleteCalendarEventForUser(name, eventToLeave.calendarEventIds[userLower]);
      } catch (e) {
        console.error('Error deleting calendar event for leaving user', e);
      }
    }

    const prevEvents = { ...eventsBySport };
    const updatedSportEvents = events.map((e) => {
      if (e.id !== eventId) return e;

      const participants = Array.isArray(e.participants) ? e.participants : [];
      const nextParticipants = participants.filter(
        (p) => (p || '').trim().toLowerCase() !== name.trim().toLowerCase()
      );

      // Remove calendar event ID for the user who left
      const updatedCalendarEventIds = { ...(e.calendarEventIds || {}) };
      delete updatedCalendarEventIds[userLower];

      return {
        ...e,
        participants: nextParticipants,
        calendarEventIds: updatedCalendarEventIds,
      };
    });

    const updated = { ...eventsBySport, [sportId]: updatedSportEvents };
    
    // Check if event dropped below minimum and delete all calendar events if so
    checkAndAddToCalendar(prevEvents, updated, sport, name, (sId, eId, calendarUpdate) => {
      if (sId === sportId && eId === eventId) {
        const updatedSportEventsWithCalendar = updatedSportEvents.map((e) => {
          if (e.id !== eventId) return e;
          return {
            ...e,
            ...calendarUpdate,
            calendarEventIds: {
              ...(e.calendarEventIds || {}),
              ...(calendarUpdate.calendarEventIds || {}),
            },
          };
        });
        const newUpdated = { ...updated, [sportId]: updatedSportEventsWithCalendar };
        onUpdateEvents(newUpdated);
      }
    });
    
    onUpdateEvents(updated);
  };

  const totalPlayers = events.reduce(
    (sum, e) => sum + (Array.isArray(e.participants) ? e.participants.length : 0),
    0
  );

  return (
    <>
      <div className="top-bar">
        <div>
          <div className="breadcrumb">
            <button className="back-button" onClick={onBack}>
              <span>←</span>
              <span>All sports</span>
            </button>
            <span>/</span>
            <span className="current">{sport.name}</span>
          </div>
          <h1 className="page-title">{sport.name} sessions</h1>
          <p className="page-subtitle">
            Create a new game or join an existing session with Pomfret classmates.
          </p>
        </div>
      </div>

      <div className="event-layout">
        <div className="event-main">
          <div className="event-header-card">
            <div className="event-header-top">
              <div>
                <div className="event-chip">Upcoming games</div>
                <div className="event-title">Plan your next run</div>
                <div className="event-subtitle">
                  Choose a time that works, set your player cap, and let others
                  fill the open spots. Your sessions are saved online so
                  classmates can see them from any device.
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <label className="form-label" style={{ marginBottom: '0.25rem' }}>
                    Your name (to manage your sessions)
                  </label>
                  <input
                    className="form-input"
                    style={{ maxWidth: '220px' }}
                    placeholder="Enter your name"
                    value={currentUserName}
                    onChange={(e) => setCurrentUserName(e.target.value)}
                  />
                </div>
                <button
                  className="primary-button"
                  onClick={() => setShowModal(true)}
                >
                  New {sport.name} event
                </button>
              </div>
            </div>
            <div className="event-meta-row">
              <span className="meta-pill">Default location: {sport.locationHint}</span>
              <span className="meta-pill">Saved in Pomfret Sports Connect (no login needed)</span>
            </div>
          </div>

          <div style={{ marginTop: '1rem' }}>
            {events.length === 0 ? (
              <div className="empty-state">
                <strong>No sessions yet.</strong> Be the first to host a game and
                bring classmates together.
              </div>
            ) : (
              <div className="event-list">
                {events.map((event) => {
                  const canDelete =
                    currentUserName &&
                    event.hostName &&
                    event.hostName.trim().toLowerCase() ===
                      currentUserName.trim().toLowerCase();

                  const isHost = !!canDelete;

                  const alreadyParticipant = Array.isArray(event.participants)
                    ? event.participants.some(
                        (p) =>
                          (p || '').trim().toLowerCase() ===
                          (currentUserName || '').trim().toLowerCase()
                      )
                    : false;

                  const joinHandler = alreadyParticipant
                    ? undefined
                    : () => handleJoin(event.id);

                  const cancelHandler = alreadyParticipant
                    ? () => handleCancelJoin(event.id)
                    : undefined;

                  return (
                    <EventCard
                      key={event.id}
                      event={event}
                      onJoin={joinHandler}
                      onCancel={cancelHandler}
                      onDelete={canDelete ? () => handleDelete(event.id) : undefined}
                      canDelete={!!canDelete}
                      isHost={isHost}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="event-sidebar">
          <div className="sidebar-card">
            <div className="sidebar-title">Session snapshot</div>
            <p className="sidebar-text">
              All events are stored in a shared Pomfret Sports Connect database.
              Students can see the latest sessions from any browser.
            </p>
            <div className="sidebar-stat-row">
              <span className="stat-label">Total sessions</span>
              <span className="stat-value">{events.length}</span>
            </div>
            <div className="sidebar-stat-row">
              <span className="stat-label">Players joined</span>
              <span className="stat-value">{totalPlayers}</span>
            </div>
            <div className="sidebar-stat-row">
              <span className="stat-label">Sport</span>
              <span className="stat-value">{sport.name}</span>
            </div>
          </div>
        </aside>
      </div>

      {showModal && (
        <CreateEventModal
          sport={sport}
          onClose={() => setShowModal(false)}
          onCreate={handleCreateEvent}
          initialHostName={currentUserName || userName}
        />
      )}
    </>
  );
}

function EventCard({ event, onJoin, onCancel, onDelete, canDelete, isHost }) {
  const filled = event.participants.length;
  const isFull = filled >= event.maxPlayers;
  const isParticipant = !!onCancel;
  const cannotJoin = (!isParticipant && isFull) || isHost || (!onJoin && !onCancel);
  const extra = Math.max(0, filled - 3);
  const initialParticipants = event.participants.slice(0, 3);

  return (
    <article className="event-card">
      <div className="event-top-row">
        <div>
          <div className="host-name">Hosted by {event.hostName}</div>
          <div className="event-location">{event.location}</div>
        </div>
        <div className="event-time">{event.timeLabel}</div>
      </div>

      <div className="event-center-row">
        <div className="event-participants">
          <div className="event-participant-avatars">
            {initialParticipants.map((name) => (
              <div key={name} className="avatar-circle">
                {name.charAt(0).toUpperCase()}
              </div>
            ))}
            {extra > 0 && (
              <div className="avatar-circle more">+{extra}</div>
            )}
          </div>
          <div style={{ marginTop: '0.15rem' }}>
            {filled}/{event.maxPlayers} players joined
          </div>
          {event.participants.length > 0 && (
            <div style={{ marginTop: '0.15rem', fontSize: '0.75rem', color: '#d1d5db' }}>
              {event.participants.join(', ')}
            </div>
          )}
        </div>
        <button
          className="join-button"
          onClick={isParticipant ? onCancel : onJoin}
          disabled={cannotJoin}
        >
          {isHost
            ? 'You are host'
            : isParticipant
            ? 'Leave game'
            : isFull
            ? 'Game full'
            : 'Join game'}
        </button>
      </div>

      <div className="event-bottom-row">
        <span className="event-capacity">
          Time: {event.timeRaw ? new Date(event.timeRaw).toLocaleString() : event.timeLabel}
        </span>
        <span className="event-capacity">Location: {event.location}</span>
        {canDelete && onDelete && (
          <button
            type="button"
            className="text-button"
            style={{ marginLeft: 'auto' }}
            onClick={onDelete}
          >
            Delete session
          </button>
        )}
      </div>
    </article>
  );
}

function CreateEventModal({ sport, onClose, onCreate, initialHostName }) {
  const [hostName, setHostName] = useState(initialHostName || '');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState(sport.locationHint || '');
  const [maxPlayers, setMaxPlayers] = useState(6);
  const [minPlayers, setMinPlayers] = useState(2);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!hostName || !time || !location || !maxPlayers || !minPlayers) {
      return;
    }

    const date = new Date(time);
    const timeLabel = isNaN(date.getTime())
      ? 'Custom time'
      : date.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });

    const newEvent = {
      id: `${sport.id}-${Date.now()}`,
      sportId: sport.id,
      hostName,
      timeRaw: time,
      timeLabel,
      location,
      maxPlayers: Number(maxPlayers) || 0,
      minPlayers: Number(minPlayers) || 1,
      participants: [],
    };

    onCreate(newEvent);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-panel">
        <div className="modal-header">
          <div>
            <div className="modal-title">New {sport.name} event</div>
            <div className="modal-subtitle">
              Fill out the quick details below. Your session will be saved so
              other Pomfret students can see and join.
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="form-grid">
          <div className="form-field">
            <label className="form-label">Student host name</label>
            <input
              className="form-input"
              placeholder="e.g. Jordan P. or Taylor R."
              value={hostName}
              onChange={(e) => setHostName(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Event time</label>
            <input
              type="datetime-local"
              className="form-input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Location</label>
            <input
              className="form-input"
              placeholder="Corzine Athletic Center, Student Union, etc."
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Max players</label>
            <input
              type="number"
              min="2"
              max="30"
              className="form-input"
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label className="form-label">Minimum players to confirm</label>
            <input
              type="number"
              min="1"
              max="30"
              className="form-input"
              value={minPlayers}
              onChange={(e) => setMinPlayers(e.target.value)}
            />
          </div>

          <div className="form-footer">
            <button type="button" className="text-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              Save event
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NameEntryScreen({ onNameSet }) {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setError('');

    setLoading(true);
    try {
      const profileName = await signInWithGoogle();
      const ok = await registerUser(profileName);
      setLoading(false);

      if (ok) {
        onNameSet(profileName);
      } else {
        setError('Something went wrong. Try again.');
      }
    } catch (e) {
      setLoading(false);
      setError('Google sign-in failed. Try again.');
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-header">
          <div className="logo-mark" style={{ width: 50, height: 50 }}>
            <span style={{ fontSize: '1rem' }}>PSC</span>
          </div>
          <h1 className="auth-title">Pomfret Sports Connect</h1>
          <p className="auth-subtitle">Sign in with your Pomfret Google account</p>
        </div>

        <form className="auth-form" onSubmit={(e) => e.preventDefault()}>
          {error && <div className="auth-error">{error}</div>}

          <button
            type="button"
            className="primary-button auth-submit"
            disabled={loading}
            onClick={handleGoogleSignIn}
          >
            {loading ? 'Please wait...' : 'Continue with Google'}
          </button>
        </form>
      </div>
    </div>
  );
}

function App() {
  const [userName, setUserName] = useState(() => {
    const stored = localStorage.getItem('pomfretUserName');
    return stored || null;
  });
  const [selectedSportId, setSelectedSportId] = useState(null);
  const [eventsBySport, setEventsBySport] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  const handleNameSet = (name) => {
    setUserName(name);
  };

  const handleChangeName = () => {
    clearLocalUser();
    const auth = firebase.auth();
    auth
      .signOut()
      .catch((e) => {
        console.error('Failed to sign out from Firebase', e);
      })
      .finally(() => {
        setUserName(null);
      });
  };

  useEffect(() => {
    const db = firebase.firestore();
    const docRef = db.collection('appState').doc('events');

    const unsubscribe = docRef.onSnapshot(
      (snap) => {
        if (!snap.exists) {
          setEventsBySport({});
        } else {
          const data = snap.data();
          const incoming =
            typeof data.eventsBySport === 'object' && data.eventsBySport !== null
              ? data.eventsBySport
              : {};

          const { eventsBySport: cleaned } = cleanExpiredEvents(incoming);
          setEventsBySport(cleaned || {});
        }
        setIsLoading(false);
      },
      (error) => {
        console.error('Realtime listener error', error);
        setIsLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Check for newly confirmed events when eventsBySport changes (e.g., from other users)
  // Use a ref to track if we've already checked this update
  const prevEventsRef = React.useRef(null);
  
  useEffect(() => {
    if (isLoading || !userName) {
      prevEventsRef.current = eventsBySport;
      return;
    }
    
    // Only check if we have previous state to compare and it's different
    if (prevEventsRef.current && prevEventsRef.current !== eventsBySport) {
      const updateEventWithCalendarIds = (sportId, eventId, calendarUpdate) => {
        setEventsBySport((current) => {
          const updatedSportEvents = ((current[sportId] || [])).map((e) => {
            if (e.id !== eventId) return e;
            return {
              ...e,
              ...calendarUpdate,
              calendarEventIds: {
                ...(e.calendarEventIds || {}),
                ...(calendarUpdate.calendarEventIds || {}),
              },
            };
          });
          return { ...current, [sportId]: updatedSportEvents };
        });
      };
      
      checkAndAddToCalendar(prevEventsRef.current, eventsBySport, null, userName, updateEventWithCalendarIds);
    }
    
    prevEventsRef.current = eventsBySport;
  }, [eventsBySport, isLoading, userName]);

  useEffect(() => {
    if (isLoading) return;
    saveEventsToFirebase(eventsBySport);
  }, [eventsBySport, isLoading]);

  useEffect(() => {
    const interval = setInterval(() => {
      setEventsBySport((prev) => {
        const { eventsBySport: cleaned, changed } = cleanExpiredEvents(prev || {});
        return changed ? cleaned : prev;
      });
    }, 60 * 1000); // every minute

    return () => clearInterval(interval);
  }, []);

  const handleUpdateEvents = (updated) => {
    // Callback to update event with calendar event IDs
    const updateEventWithCalendarIds = (sportId, eventId, calendarUpdate) => {
      const updatedSportEvents = (updated[sportId] || []).map((e) => {
        if (e.id !== eventId) return e;
        return {
          ...e,
          ...calendarUpdate,
          calendarEventIds: {
            ...(e.calendarEventIds || {}),
            ...(calendarUpdate.calendarEventIds || {}),
          },
        };
      });
      const newUpdated = { ...updated, [sportId]: updatedSportEvents };
      setEventsBySport(newUpdated);
    };

    // Check if any events just became confirmed and automatically add to calendars
    checkAndAddToCalendar(eventsBySport, updated, null, userName, updateEventWithCalendarIds);
    setEventsBySport(updated);
  };

  // Show name entry if no name set
  if (!userName) {
    return <NameEntryScreen onNameSet={handleNameSet} />;
  }

  return (
    <AppShell userName={userName} onSignOut={handleChangeName}>
      {selectedSportId ? (
        <SportPage
          sportId={selectedSportId}
          eventsBySport={eventsBySport}
          onBack={() => setSelectedSportId(null)}
          onUpdateEvents={handleUpdateEvents}
          userName={userName}
        />
      ) : (
        <Home
          onSelectSport={setSelectedSportId}
          userName={userName}
          eventsBySport={eventsBySport}
        />
      )}
    </AppShell>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
