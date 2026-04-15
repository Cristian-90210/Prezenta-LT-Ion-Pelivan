import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

interface AttRec {
  id: string;
  prenume: string;
  nume: string;
  clasa: string;
  data: string;
  timestamp: Date;
  materie: string;
}

export default function PrezentaMeaPage() {
  const [searchParams] = useSearchParams();
  const emailParam = searchParams.get('email') ?? '';

  const [email, setEmail] = useState(emailParam);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [records, setRecords] = useState<AttRec[]>([]);
  const [error, setError] = useState('');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') !== 'false');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  const doSearch = useCallback(async (em: string) => {
    const normalized = em.trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) {
      setError('Introduceți o adresă de email validă.');
      return;
    }
    setError('');
    setSearching(true);
    setSearched(true);
    try {
      const q = query(collection(db, 'prezenta'), where('email', '==', normalized));
      const snap = await getDocs(q);
      const data: AttRec[] = snap.docs.map(d => ({
        id: d.id,
        prenume: d.data().prenume ?? '',
        nume: d.data().nume ?? '',
        clasa: d.data().clasa ?? '',
        data: d.data().data ?? '',
        timestamp: d.data().timestamp?.toDate() ?? new Date(),
        materie: d.data().materie ?? '',
      })).sort((a, b) => b.data.localeCompare(a.data));
      setRecords(data);
    } catch {
      setError('Eroare la căutare. Verificați conexiunea și încercați din nou.');
    } finally {
      setSearching(false);
    }
  }, []);

  // Auto-search when email comes from URL
  useEffect(() => {
    if (emailParam) doSearch(emailParam);
  }, [emailParam, doSearch]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doSearch(email);
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const studentName = records.length > 0 ? `${records[0].prenume} ${records[0].nume}` : '';
  const studentClasa = records.length > 0 ? records[0].clasa : '';

  const bySubject = records.reduce<{ [k: string]: number }>((acc, r) => {
    const key = r.materie || 'Nespecificat';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const subjectEntries = Object.entries(bySubject).sort((a, b) => b[1] - a[1]);
  const maxCount = subjectEntries.length > 0 ? Math.max(...subjectEntries.map(([, c]) => c)) : 1;

  const fmtDate = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('ro-RO', {
      weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
    });

  // ── Form ──────────────────────────────────────────────────────────────────
  const formCard = (
    <div className="card" style={{ maxWidth: 420 }}>
      <div className="card-header" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)' }}>
        <div className="school-icon">📋</div>
        <h1>Prezența Mea</h1>
        <p className="subtitle">LT Ion Pelivan</p>
      </div>
      <form onSubmit={handleSubmit} className="form">
        <div className="field">
          <label htmlFor="pm-email">Adresă de email</label>
          <input
            id="pm-email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="ion.popescu@scoala.ro"
            autoComplete="email"
            autoFocus={!emailParam}
            disabled={searching}
          />
          <span className="field-hint">Adresa folosită la înregistrarea prezenței</span>
        </div>
        {error && <p className="error-msg">{error}</p>}
        <button type="submit" className="btn-primary" disabled={searching}>
          {searching ? 'Se caută...' : 'Caută prezența'}
        </button>
      </form>
      <div style={{ padding: '0 28px 16px', textAlign: 'right' }}>
        <button className="btn-dark-toggle" onClick={() => setDarkMode(d => !d)}>
          {darkMode ? '☀ Mod luminos' : '🌙 Mod întunecat'}
        </button>
      </div>
    </div>
  );

  // ── Loading ───────────────────────────────────────────────────────────────
  if (searching) {
    return (
      <div className="page-center">
        <div className="card" style={{ maxWidth: 420 }}>
          <div style={{ padding: '48px 28px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Se caută prezența...
          </div>
        </div>
      </div>
    );
  }

  // ── Empty / Not searched ──────────────────────────────────────────────────
  if (!searched || (searched && records.length === 0 && !error)) {
    return (
      <div className="page-center">
        {searched && records.length === 0 ? (
          <div className="card" style={{ maxWidth: 480 }}>
            <div className="card-header" style={{ background: '#6b7280' }}>
              <div className="school-icon">🔍</div>
              <h1>Niciun rezultat</h1>
            </div>
            <div style={{ padding: '28px', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
                Nu am găsit prezențe pentru <strong>{email}</strong>.<br />
                Asigurați-vă că folosiți același email de la înregistrare.
              </p>
              <button className="btn-primary" onClick={() => { setSearched(false); setRecords([]); }}>
                Încearcă din nou
              </button>
            </div>
          </div>
        ) : formCard}
      </div>
    );
  }

  // ── Results ───────────────────────────────────────────────────────────────
  return (
    <div className="page-center" style={{ alignItems: 'flex-start', paddingTop: 32 }}>
      <div className="pm-container">

        {/* Header card */}
        <div className="pm-header-card">
          <div className="pm-avatar">{records[0].prenume.charAt(0).toUpperCase()}</div>
          <div className="pm-identity">
            <h2 className="pm-name">{studentName}</h2>
            <span className="pm-meta">Clasa {studentClasa} · {email}</span>
          </div>
          <div className="pm-total-badge">{records.length} prezențe</div>
        </div>

        {/* Subject summary */}
        <div className="pm-section-title">Prezențe per materie</div>
        <div className="pm-subjects">
          {subjectEntries.map(([subject, count]) => (
            <div className="pm-subject-row" key={subject}>
              <span className="pm-subject-name">{subject}</span>
              <div className="pm-subject-bar-track">
                <div
                  className="pm-subject-bar-fill"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </div>
              <span className="pm-subject-count">{count} {count === 1 ? 'zi' : 'zile'}</span>
            </div>
          ))}
        </div>

        {/* Chronological detail */}
        <div className="pm-section-title" style={{ marginTop: 24 }}>
          Istoric detaliat
          <button
            className="btn-dark-toggle"
            style={{ marginLeft: 'auto' }}
            onClick={() => setDarkMode(d => !d)}
          >
            {darkMode ? '☀' : '🌙'}
          </button>
        </div>
        <div className="pm-records">
          {records.map(r => (
            <div className="pm-record-row" key={r.id}>
              <div className="pm-record-date">{fmtDate(r.data)}</div>
              <div className="pm-record-badges">
                <span className="badge">{r.clasa}</span>
                {r.materie && (
                  <span className="badge badge--success">
                    {r.materie}
                  </span>
                )}
              </div>
              <div className="pm-record-time">
                {r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            className="btn-action"
            onClick={() => { setSearched(false); setRecords([]); }}
          >
            ← Caută alt email
          </button>
        </div>

      </div>
    </div>
  );
}
