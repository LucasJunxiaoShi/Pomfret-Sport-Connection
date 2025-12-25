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

    // Store the OAuth access token from the credential
    // Firebase Auth credential contains the Google OAuth token
    const credential = result.credential;
    if (credential) {
      // The accessToken property should be available in the credential
      const accessToken = credential.accessToken || (credential.oauthAccessToken) || (credential.providerId === 'google.com' && credential.accessToken);
      if (accessToken) {
        // Store token for calendar API calls (in sessionStorage for security)
        sessionStorage.setItem('googleCalendarToken', accessToken);
      }
    }

    return profileName;
  } catch (e) {
    console.error('Google sign-in failed', e);
    throw e;
  }
}

// Get Google OAuth access token
async function getGoogleAccessToken() {
  try {
    // First check if we have a stored token
    const storedToken = sessionStorage.getItem('googleCalendarToken');
    if (storedToken) {
      // Basic validation - check if token looks valid (starts with ya29. or similar)
      if (storedToken.length > 50) {
        return storedToken;
      }
    }

    // If no stored token or invalid, return null (will use link method as fallback)
    return null;
  } catch (e) {
    console.error('Error getting access token', e);
    return null;
  }
}

// Google Calendar integration
async function addEventToGoogleCalendar(event, sport, participantName) {
  try {
    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
      console.warn('No access token available for Google Calendar');
      // Fallback to link method
      return createCalendarEventViaLink(event, sport);
    }

    // Format the event date - use 30 minutes duration
    const eventDate = new Date(event.timeRaw);
    const eventEndDate = new Date(eventDate);
    eventEndDate.setMinutes(eventEndDate.getMinutes() + 30); // 30 minutes duration

    // Format dates for Google Calendar API (RFC3339 format)
    const formatDateForAPI = (date) => {
      return date.toISOString();
    };

    const participantsList = event.participants && event.participants.length > 0
      ? `\nParticipants: ${event.participants.join(', ')}`
      : '';

    const calendarEvent = {
      summary: `${sport.name} - ${event.hostName}`,
      description: `Pomfret Sports Connect - ${sport.name} game\nHost: ${event.hostName}\nLocation: ${event.location}${participantsList}`,
      location: event.location,
      start: {
        dateTime: formatDateForAPI(eventDate),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: formatDateForAPI(eventEndDate),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    };

    // Create calendar event via API
    const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(calendarEvent),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Failed to create calendar event', errorData);
      // Fallback to link method
      return createCalendarEventViaLink(event, sport);
    }

    const createdEvent = await response.json();
    console.log('Calendar event created:', createdEvent.id);
    return createdEvent.id; // Return the calendar event ID
  } catch (e) {
    console.error('Error adding event to Google Calendar', e);
    // Fallback to link method
    return createCalendarEventViaLink(event, sport);
  }
}

// Fallback: Create calendar event via link (opens in new tab)
function createCalendarEventViaLink(event, sport) {
  try {
    const eventDate = new Date(event.timeRaw);
    const eventEndDate = new Date(eventDate);
    eventEndDate.setMinutes(eventEndDate.getMinutes() + 30);
    
    const calendarLink = createGoogleCalendarLink(event, sport, eventDate, eventEndDate);
    window.open(calendarLink, '_blank');
    return null; // No calendar ID for link method
  } catch (e) {
    console.error('Error creating calendar link', e);
    return null;
  }
}

// Update Google Calendar event with new participants
async function updateCalendarEventParticipants(event, sport, calendarEventId) {
  try {
    if (!calendarEventId) return false;

    const accessToken = await getGoogleAccessToken();
    if (!accessToken) {
      console.warn('No access token available for updating calendar event');
      return false;
    }

    // First, get the existing event
    const getResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${calendarEventId}`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      }
    );

    if (!getResponse.ok) {
      console.error('Failed to get calendar event for update');
      return false;
    }

    const existingEvent = await getResponse.json();
    
    // Update the description with new participants
    const participantsList = event.participants && event.participants.length > 0
      ? `\nParticipants: ${event.participants.join(', ')}`
      : '';

    const updatedEvent = {
      ...existingEvent,
      description: `Pomfret Sports Connect - ${sport.name} game\nHost: ${event.hostName}\nLocation: ${event.location}${participantsList}`,
    };

    // Update the event
    const updateResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${calendarEventId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updatedEvent),
      }
    );

    if (!updateResponse.ok) {
      console.error('Failed to update calendar event');
      return false;
    }

    console.log('Calendar event updated with new participants');
    return true;
  } catch (e) {
    console.error('Error updating calendar event', e);
    return false;
  }
}

// Helper function to create Google Calendar link (fallback method)
function createGoogleCalendarLink(event, sport, eventDate, eventEndDate) {
  const formatDate = (date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  const participantsList = event.participants && event.participants.length > 0
    ? `\nParticipants: ${event.participants.join(', ')}`
    : '';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `${sport.name} - ${event.hostName}`,
    dates: `${formatDate(eventDate)}/${formatDate(eventEndDate)}`,
    details: `Pomfret Sports Connect - ${sport.name} game\nHost: ${event.hostName}\nLocation: ${event.location}${participantsList}`,
    location: event.location,
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Check if event just became confirmed and add to calendar, or update if participants changed
async function checkAndAddToCalendar(prevEvents, updatedEvents, sport, userName, onUpdateEvent) {
  try {
    if (!userName) return;
    
    // Get list of sport IDs to check (if sport is provided, only check that one)
    const sportIdsToCheck = sport 
      ? [sport.id] 
      : Object.keys(updatedEvents);

    // Compare events to see if any just became confirmed or participants changed
    sportIdsToCheck.forEach(async (sportId) => {
      const sportData = sport || SPORTS.find((s) => s.id === sportId);
      if (!sportData) return;

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

        // Check if participants list changed
        const prevParticipants = prevEvent?.participants || [];
        const currentParticipants = updatedEvent.participants || [];
        const participantsChanged = JSON.stringify(prevParticipants.sort()) !== JSON.stringify(currentParticipants.sort());

        // If event just became confirmed, create calendar events for all participants
        if (!wasConfirmed && isNowConfirmed) {
          // Create calendar event for host
          const hostNameLower = (updatedEvent.hostName || '').trim().toLowerCase();
          if (hostNameLower) {
            try {
              // Note: We'll create calendar events for all participants
              // Store calendar event IDs in a map keyed by participant name
              const calendarEventIds = updatedEvent.calendarEventIds || {};
              
              // Create calendar event (this will be stored per user's calendar)
              // We'll track it by storing the event ID in the event object
              const calendarEventId = await addEventToGoogleCalendar(updatedEvent, sportData, updatedEvent.hostName);
              if (calendarEventId && onUpdateEvent) {
                // Update event with calendar event ID for host
                calendarEventIds[hostNameLower] = calendarEventId;
                onUpdateEvent(sportId, updatedEvent.id, { calendarEventIds });
              }
            } catch (e) {
              console.error('Error creating calendar event for host', e);
            }
          }

          // Create calendar events for all participants
          for (const participant of currentParticipants) {
            const participantLower = (participant || '').trim().toLowerCase();
            if (!participantLower || participantLower === hostNameLower) continue;
            
            try {
              const calendarEventId = await addEventToGoogleCalendar(updatedEvent, sportData, participant);
              if (calendarEventId && onUpdateEvent) {
                const calendarEventIds = updatedEvent.calendarEventIds || {};
                calendarEventIds[participantLower] = calendarEventId;
                onUpdateEvent(sportId, updatedEvent.id, { calendarEventIds });
              }
            } catch (e) {
              console.error(`Error creating calendar event for participant ${participant}`, e);
            }
          }
        }
        // If event is already confirmed and participants changed, update calendar events
        else if (isNowConfirmed && participantsChanged && updatedEvent.calendarEventIds) {
          // Update calendar events for all participants who have calendar event IDs
          const calendarEventIds = updatedEvent.calendarEventIds || {};
          
          for (const [participantName, calendarEventId] of Object.entries(calendarEventIds)) {
            if (calendarEventId) {
              try {
                await updateCalendarEventParticipants(updatedEvent, sportData, calendarEventId);
              } catch (e) {
                console.error(`Error updating calendar event for ${participantName}`, e);
              }
            }
          }

          // If a new participant joined, create calendar event for them
          const newParticipants = currentParticipants.filter(
            (p) => !prevParticipants.includes(p)
          );
          
          for (const newParticipant of newParticipants) {
            const participantLower = (newParticipant || '').trim().toLowerCase();
            const hostNameLower = (updatedEvent.hostName || '').trim().toLowerCase();
            
            if (participantLower && participantLower !== hostNameLower && !calendarEventIds[participantLower]) {
              try {
                const calendarEventId = await addEventToGoogleCalendar(updatedEvent, sportData, newParticipant);
                if (calendarEventId && onUpdateEvent) {
                  calendarEventIds[participantLower] = calendarEventId;
                  onUpdateEvent(sportId, updatedEvent.id, { calendarEventIds });
                }
              } catch (e) {
                console.error(`Error creating calendar event for new participant ${newParticipant}`, e);
              }
            }
          }
        }
      }
    });
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
    // Check if this event just became confirmed or participants changed
    checkAndAddToCalendar(prevEvents, updated, sport, name, (sId, eId, calendarUpdate) => {
      if (sId === sportId && eId === eventId) {
        updateEventWithCalendarIds(eventId, calendarUpdate);
      }
    });
    onUpdateEvents(updated);
  };

  const handleDelete = (eventId) => {
    const updatedSportEvents = events.filter((e) => e.id !== eventId);
    const updated = { ...eventsBySport, [sportId]: updatedSportEvents };
    onUpdateEvents(updated);
  };

  const handleCancelJoin = (eventId) => {
    const name = (currentUserName || '').trim();
    if (!name) {
      window.alert('Enter your name in the box at the top first.');
      return;
    }

    const updatedSportEvents = events.map((e) => {
      if (e.id !== eventId) return e;

      const participants = Array.isArray(e.participants) ? e.participants : [];
      const nextParticipants = participants.filter(
        (p) => (p || '').trim().toLowerCase() !== name.trim().toLowerCase()
      );

      return {
        ...e,
        participants: nextParticipants,
      };
    });

    const updated = { ...eventsBySport, [sportId]: updatedSportEvents };
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
      // Callback to update event with calendar event IDs
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

    // Check if any events just became confirmed and add to calendar
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
