const { useState, useEffect } = React;

const SPORTS = [
  {
    id: 'billiards',
    name: 'Billiards',
    tagline: 'Precision shots in the OSU.',
    locationHint: 'OSU, at the pool tables',
  },
  {
    id: 'soccer',
    name: 'Soccer',
    tagline: 'Small-sided matches under the lights.',
    locationHint: 'Fields or turf',
  },
  {
    id: 'basketball',
    name: 'Basketball',
    tagline: 'Pickup runs in Lewis Gymnasium.',
    locationHint: 'Lewis Gymnasium',
  },
  {
    id: 'squash',
    name: 'Squash',
    tagline: 'Fast rallies on the courts.',
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

function AppShell({ children }) {
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

function Home({ onSelectSport }) {
  return (
    <>
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
            Organize pickup games, fill open spots, and keep Cardinal energy high
            after classes. All student-run, all Pomfret pride.
          </p>
          <p className="banner-text" style={{ marginTop: '0.9rem' }}>
            Use this app to see where and when students are playing, host your own
            sessions, and help everyone find the right spot on campus to join in.
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
          <h2 className="section-heading">Choose your sport</h2>
          <p className="section-caption">
            Tap a card to view sessions, create games, and join other Pomfret
            students.
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

function SportPage({ sportId, eventsBySport, onBack, onUpdateEvents }) {
  const sport = SPORTS.find((s) => s.id === sportId);
  const [showModal, setShowModal] = useState(false);
  const [currentUserName, setCurrentUserName] = useState('');

  const events = eventsBySport[sportId] || [];

  const handleCreateEvent = (newEvent) => {
    const updated = {
      ...eventsBySport,
      [sportId]: [...events, newEvent],
    };
    onUpdateEvents(updated);
    setShowModal(false);
  };

  const handleJoin = (eventId) => {
    const updatedSportEvents = events.map((e) => {
      if (e.id !== eventId) return e;
      if (e.participants.length >= e.maxPlayers) return e;
      // For now we push a generic placeholder participant name
      const nextNumber = e.participants.length + 1;
      const name = `Player ${nextNumber}`;
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

function CreateEventModal({ sport, onClose, onCreate }) {
  const [hostName, setHostName] = useState('');
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

function App() {
  const [selectedSportId, setSelectedSportId] = useState(null);
  const [eventsBySport, setEventsBySport] = useState({});
  const [isLoading, setIsLoading] = useState(true);

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

  return (
    <AppShell>
      {selectedSportId ? (
        <SportPage
          sportId={selectedSportId}
          eventsBySport={eventsBySport}
          onBack={() => setSelectedSportId(null)}
          onUpdateEvents={handleUpdateEvents}
        />
      ) : (
        <Home onSelectSport={setSelectedSportId} />
      )}
    </AppShell>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
