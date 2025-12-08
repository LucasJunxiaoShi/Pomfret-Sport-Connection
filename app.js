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

// Challenge helpers (using name as identifier)
// timeRaw/timeLabel are optional; status/lastUpdatedBy support scheduling flow.
async function sendChallenge(fromName, toName, sportName, timeRaw, timeLabel) {
  try {
    const db = firebase.firestore();
    await db.collection('challenges').add({
      fromName: fromName.trim(),
      fromNameLower: fromName.toLowerCase().trim(),
      toName: toName.trim(),
      toNameLower: toName.toLowerCase().trim(),
      sport: sportName,
      timeRaw: timeRaw || null,
      timeLabel: timeLabel || null,
      status: 'pending',
      lastUpdatedBy: 'from',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error('Failed to send challenge', e);
    return false;
  }
}

async function dismissChallenge(challengeId) {
  try {
    const db = firebase.firestore();
    await db.collection('challenges').doc(challengeId).delete();
  } catch (e) {
    console.error('Failed to dismiss challenge', e);
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
                Change name
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
          <span>Cardinal Red · Black · White</span>
        </div>
      </footer>
    </div>
  );
}

function Home({ onSelectSport, userName }) {
  const [challenges, setChallenges] = useState([]);

  // Listen for incoming challenges
  useEffect(() => {
    if (!userName) return;
    const db = firebase.firestore();
    const nameLower = userName.toLowerCase().trim();
    const unsubscribe = db
      .collection('challenges')
      .where('toNameLower', '==', nameLower)
      .orderBy('createdAt', 'desc')
      .onSnapshot(
        (snap) => {
          const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
          setChallenges(list);
        },
        (err) => console.error('Challenge listener error', err)
      );
    return () => unsubscribe();
  }, [userName]);

  const handleHomeUpdate = async (id, updates) => {
    try {
      const db = firebase.firestore();
      await db.collection('challenges').doc(id).update(updates);
    } catch (e) {
      console.error('Failed to update challenge from home inbox', e);
    }
  };

  const handleHomeAccept = async (challenge) => {
    await handleHomeUpdate(challenge.id, {
      status: 'accepted',
      lastUpdatedBy: 'to',
    });
  };

  const handleHomeDismiss = async (challenge) => {
    await handleHomeUpdate(challenge.id, {
      status: 'dismissed',
      lastUpdatedBy: 'to',
    });
  };

  const handleHomeChangeTime = async (challenge) => {
    try {
      const existing = challenge.timeRaw || '';
      const input = window.prompt(
        'Pick a new time for this challenge (YYYY-MM-DDTHH:MM):',
        existing
      );
      if (!input) return;

      const date = new Date(input);
      const label = isNaN(date.getTime())
        ? 'Custom time'
        : date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });

      await handleHomeUpdate(challenge.id, {
        timeRaw: input,
        timeLabel: label,
        status: 'pending',
        lastUpdatedBy: 'to',
      });
    } catch (e) {
      console.error('Failed to change time from home inbox', e);
    }
  };

  return (
    <>
      {challenges.length > 0 && (
        <section className="challenges-inbox">
          <h3 className="challenges-inbox-title">🔥 You've been called out!</h3>
          <div className="challenges-list">
            {challenges
              .filter((c) => c.status !== 'dismissed')
              .map((c) => {
                const timeText = c.timeLabel || 'Time not set yet';
                const statusText =
                  c.status === 'accepted'
                    ? 'Accepted'
                    : c.status === 'dismissed'
                    ? 'Dismissed'
                    : 'Pending';

                const canRespond = !c.status || c.status === 'pending';

                return (
                  <div key={c.id} className="challenge-card">
                    <div className="challenge-card-text">
                      <strong>{c.fromName}</strong> challenged you to <strong>{c.sport}</strong>
                      <span
                        style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af' }}
                      >
                        Time: {timeText}
                      </span>
                      <span
                        style={{ display: 'block', fontSize: '0.8rem', color: '#9ca3af' }}
                      >
                        Status: {statusText}
                      </span>
                    </div>
                    {canRespond ? (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button
                          className="secondary-button"
                          onClick={() => handleHomeAccept(c)}
                        >
                          Accept
                        </button>
                        <button
                          className="text-button"
                          onClick={() => handleHomeChangeTime(c)}
                        >
                          Change time
                        </button>
                        <button
                          className="text-button dismiss-btn"
                          onClick={() => handleHomeDismiss(c)}
                        >
                          Dismiss
                        </button>
                      </div>
                    ) : (
                      <button
                        className="text-button dismiss-btn"
                        onClick={() => handleHomeDismiss(c)}
                      >
                        Hide
                      </button>
                    )}
                  </div>
                );
              })}
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
            Stop texting 47 group chats to find a game. We made this so you can
            just show up and play.
          </p>
          <p className="banner-text" style={{ marginTop: '0.9rem' }}>
            Pick a sport, see who's playing, or start your own session. It's
            basically a vibe check for rec sports.
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
          <h2 className="section-heading">Pick your poison</h2>
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

      <section className="challenge-section">
        <h3 className="challenge-heading">Call someone out</h3>
        <p className="challenge-caption">
          Think you're better than someone? Prove it. Drop their name and send the challenge.
        </p>
        <div className="challenge-grid">
          {SPORTS.map((sport) => (
            <ChallengeRow
              key={sport.id}
              sport={sport}
              currentUserName={userName}
            />
          ))}
        </div>
      </section>
    </>
  );
}

function ChallengeRow({ sport, currentUserName }) {
  const [challengedName, setChallengedName] = useState('');
  const [status, setStatus] = useState('');
  const [time, setTime] = useState('');

  const handleChallenge = async () => {
    const name = challengedName.trim();
    if (!name) return;
    if (!time) {
      setStatus('Pick a time for the challenge.');
      return;
    }
    if (!currentUserName) {
      setStatus('Enter your name first.');
      return;
    }

    if (name.toLowerCase() === currentUserName.toLowerCase()) {
      setStatus("You can't challenge yourself!");
      return;
    }

    setStatus('Sending...');

    const date = new Date(time);
    const label = isNaN(date.getTime())
      ? 'Custom time'
      : date.toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        });

    const ok = await sendChallenge(currentUserName, name, sport.name, time, label);
    if (ok) {
      setStatus(`Challenge sent to ${name}!`);
      setChallengedName('');
      setTime('');
    } else {
      setStatus('Failed to send challenge.');
    }
  };

  return (
    <div className="challenge-row">
      <div className="challenge-sport-name">{sport.name}</div>
      <input
        className="form-input challenge-input"
        placeholder={`Name on their Pomfret Card`}
        value={challengedName}
        onChange={(e) => {
          setChallengedName(e.target.value);
          setStatus('');
        }}
      />
      <input
        type="datetime-local"
        className="form-input challenge-input"
        value={time}
        onChange={(e) => {
          setTime(e.target.value);
          setStatus('');
        }}
      />
      <button
        type="button"
        className="secondary-button challenge-button"
        onClick={handleChallenge}
      >
        Challenge
      </button>
      {status && <div className="challenge-status">{status}</div>}
    </div>
  );
}

function SportCard({ sport, onClick }) {
  return (
    <button className="sport-card" onClick={onClick}>
      <div className="sport-chip-row">
        <span className="sport-chip">Campbell Cardinals</span>
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
  const [challenges, setChallenges] = useState([]);

  const events = eventsBySport[sportId] || [];

  // Per-sport challenges for this user (Stage 2.1: display only)
  useEffect(() => {
    if (!userName) return;
    const db = firebase.firestore();
    const userLower = userName.toLowerCase().trim();

    const fromQuery = db
      .collection('challenges')
      .where('sport', '==', sport.name)
      .where('fromNameLower', '==', userLower)
      .orderBy('createdAt', 'desc');

    const toQuery = db
      .collection('challenges')
      .where('sport', '==', sport.name)
      .where('toNameLower', '==', userLower)
      .orderBy('createdAt', 'desc');

    const unsubFrom = fromQuery.onSnapshot(
      (snap) => {
        setChallenges((prev) => {
          const others = prev.filter((c) => c._source !== 'from');
          const fromDocs = snap.docs.map((doc) => ({ id: doc.id, _source: 'from', ...doc.data() }));
          return [...others, ...fromDocs];
        });
      },
      (err) => console.error('Challenge listener (from) error', err)
    );

    const unsubTo = toQuery.onSnapshot(
      (snap) => {
        setChallenges((prev) => {
          const others = prev.filter((c) => c._source !== 'to');
          const toDocs = snap.docs.map((doc) => ({ id: doc.id, _source: 'to', ...doc.data() }));
          return [...others, ...toDocs];
        });
      },
      (err) => console.error('Challenge listener (to) error', err)
    );

    return () => {
      unsubFrom();
      unsubTo();
    };
  }, [sport.name, userName]);

  const handleChallengeAccept = async (challenge) => {
    try {
      const db = firebase.firestore();
      await db.collection('challenges').doc(challenge.id).update({
        status: 'accepted',
        lastUpdatedBy:
          userName &&
          challenge.fromName &&
          challenge.fromName.toLowerCase() === userName.toLowerCase()
            ? 'from'
            : 'to',
      });
    } catch (e) {
      console.error('Failed to accept challenge', e);
    }
  };

  const handleChallengeDismiss = async (challenge) => {
    try {
      const db = firebase.firestore();
      await db.collection('challenges').doc(challenge.id).update({
        status: 'dismissed',
        lastUpdatedBy:
          userName &&
          challenge.fromName &&
          challenge.fromName.toLowerCase() === userName.toLowerCase()
            ? 'from'
            : 'to',
      });
    } catch (e) {
      console.error('Failed to dismiss challenge', e);
    }
  };
  
  const handleChallengeChangeTime = async (challenge) => {
    try {
      const existing = challenge.timeRaw || '';
      const input = window.prompt(
        'Pick a new time for this challenge (YYYY-MM-DDTHH:MM):',
        existing
      );
      if (!input) return;

      const date = new Date(input);
      const label = isNaN(date.getTime())
        ? 'Custom time'
        : date.toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });

      const db = firebase.firestore();
      await db.collection('challenges').doc(challenge.id).update({
        timeRaw: input,
        timeLabel: label,
        status: 'pending',
        lastUpdatedBy:
          userName &&
          challenge.fromName &&
          challenge.fromName.toLowerCase() === userName.toLowerCase()
            ? 'from'
            : 'to',
      });
    } catch (e) {
      console.error('Failed to change challenge time', e);
    }
  };

  const handleCreateEvent = (newEvent) => {
    const updated = {
      ...eventsBySport,
      [sportId]: [...events, newEvent],
    };
    onUpdateEvents(updated);
    setShowModal(false);
  };

  const handleJoin = (eventId) => {
    const name = (currentUserName || '').trim();
    if (!name) {
      window.alert('Enter your name in the box at the top first.');
      return;
    }

    const updatedSportEvents = events.map((e) => {
      if (e.id !== eventId) return e;
      if (e.participants.length >= e.maxPlayers) return e;
      return {
        ...e,
        participants: [...e.participants, name],
      };
    });

    const updated = { ...eventsBySport, [sportId]: updatedSportEvents };
    onUpdateEvents(updated);
  };

  const handleDelete = (eventId) => {
    const updatedSportEvents = events.filter((e) => e.id !== eventId);
    const updated = { ...eventsBySport, [sportId]: updatedSportEvents };
    onUpdateEvents(updated);
  };

  const totalPlayers = events.reduce((sum, e) => sum + e.participants.length, 0);

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

                  return (
                    <EventCard
                      key={event.id}
                      event={event}
                      onJoin={() => handleJoin(event.id)}
                      onDelete={canDelete ? () => handleDelete(event.id) : undefined}
                      canDelete={!!canDelete}
                    />
                  );
                })}
              </div>
            )}
          </div>

          {challenges.length > 0 && (
            <div style={{ marginTop: '2rem' }}>
              <div className="event-header-card">
                <div className="event-header-top">
                  <div>
                    <div className="event-chip">1-on-1 challenges</div>
                    <div className="event-title">Scheduled callouts</div>
                    <div className="event-subtitle">
                      See who you\'ve challenged or who\'s challenged you in {sport.name},
                      with the times you picked.
                    </div>
                  </div>
                </div>
              </div>
              <div className="event-list" style={{ marginTop: '1rem' }}>
                {challenges.map((c) => {
                  const isYouChallenger =
                    c.fromName &&
                    userName &&
                    c.fromName.toLowerCase() === userName.toLowerCase();

                  const label = isYouChallenger
                    ? `You challenged ${c.toName}`
                    : `${c.fromName} challenged you`;

                  const timeText = c.timeLabel || 'Time not set yet';

                  const statusText =
                    c.status === 'accepted'
                      ? 'Accepted'
                      : c.status === 'dismissed'
                      ? 'Dismissed'
                      : 'Pending';

                  const canRespond = !c.status || c.status === 'pending';

                  return (
                    <article key={c.id} className="event-card">
                      <div className="event-top-row">
                        <div>
                          <div className="host-name">{label}</div>
                          <div className="event-location">Sport: {c.sport}</div>
                        </div>
                        <div className="event-time">{timeText}</div>
                      </div>
                      <div className="event-bottom-row">
                        <span className="event-capacity">Status: {statusText}</span>
                        {canRespond && (
                          <>
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() => handleChallengeAccept(c)}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => handleChallengeChangeTime(c)}
                            >
                              Change time
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => handleChallengeDismiss(c)}
                            >
                              Dismiss
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          )}
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

          {challenges.some((c) => c.status === 'accepted') && (
            <div className="sidebar-card" style={{ marginTop: '1rem' }}>
              <div className="sidebar-title">Your scheduled games</div>
              <p className="sidebar-text">
                Accepted 1-on-1 challenges for {sport.name}. Times are local to your device.
              </p>
              <div className="sidebar-stat-row" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                {challenges
                  .filter((c) => c.status === 'accepted')
                  .map((c) => {
                    const isYouChallenger =
                      c.fromName &&
                      userName &&
                      c.fromName.toLowerCase() === userName.toLowerCase();

                    const opponent = isYouChallenger ? c.toName : c.fromName;
                    const timeText = c.timeLabel || 'Time not set yet';

                    return (
                      <div
                        key={c.id}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.1rem',
                          marginBottom: '0.5rem',
                          fontSize: '0.8rem',
                        }}
                      >
                        <span style={{ color: '#e5e7eb' }}>{timeText}</span>
                        <span style={{ color: '#9ca3af' }}>vs {opponent}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
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

function EventCard({ event, onJoin, onDelete, canDelete }) {
  const filled = event.participants.length;
  const isFull = filled >= event.maxPlayers;
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
        <button className="join-button" onClick={onJoin} disabled={isFull}>
          {isFull ? 'Game full' : 'Join game'}
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

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!hostName || !time || !location || !maxPlayers) {
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
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!displayName.trim()) {
      setError('Please enter your name.');
      return;
    }

    setLoading(true);
    const ok = await registerUser(displayName.trim());
    setLoading(false);

    if (ok) {
      onNameSet(displayName.trim());
    } else {
      setError('Something went wrong. Try again.');
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
          <p className="auth-subtitle">Enter your name to get started</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-field">
            <label className="form-label">Name on Pomfret Card</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. John Smith"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoFocus
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button
            type="submit"
            className="primary-button auth-submit"
            disabled={loading}
          >
            {loading ? 'Please wait...' : 'Let\'s go'}
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
    setUserName(null);
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
        />
      )}
    </AppShell>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
