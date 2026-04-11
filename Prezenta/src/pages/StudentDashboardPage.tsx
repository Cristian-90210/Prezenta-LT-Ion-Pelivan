import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { collection, query, where, getDocs, getDoc, doc, setDoc, Timestamp, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useConfig } from '../hooks/useConfig';

interface StudentProfile {
  prenume: string;
  nume: string;
  clasa: string;
  email: string;
}

interface AttRec {
  id: string;
  data: string;
  materie: string;
  clasa: string;
  timestamp: Date;
}

type RegState = 'idle' | 'checking' | 'ready' | 'submitting' | 'done' | 'already' | 'locked' | 'error';

function buildDocId(prenume: string, nume: string, clasa: string, data: string, materieId: string): string {
  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]/g, '_');
  return `${normalize(prenume)}|${normalize(nume)}|${clasa.toLowerCase()}|${data}${materieId ? `|${materieId}` : ''}`;
}

export default function StudentDashboardPage() {
  const { user } = useAuth();
  const { teachers } = useConfig();
  const [searchParams, setSearchParams] = useSearchParams();

  const materieId = searchParams.get('materie') ?? '';
  const clasaFromQR = searchParams.get('clasa') ?? '';
  const teacher = teachers.find(t => t.id === materieId) ?? null;

  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [records, setRecords] = useState<AttRec[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);

  const [regState, setRegState] = useState<RegState>('idle');
  const [scannerOpen, setScannerOpen] = useState(false);
  const scannerRef = useRef<any>(null);

  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  const today = new Date().toISOString().split('T')[0];

  // Load student profile
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'students', user.uid)).then(snap => {
      if (snap.exists()) setProfile(snap.data() as StudentProfile);
      setProfileLoading(false);
    }).catch(() => setProfileLoading(false));
  }, [user]);

  // Load attendance records
  const loadRecords = useCallback(async () => {
    if (!user?.email) return;
    setRecordsLoading(true);
    try {
      const q = query(collection(db, 'prezenta'), where('email', '==', user.email));
      const snap = await getDocs(q);
      const data: AttRec[] = snap.docs.map(d => ({
        id: d.id,
        data: d.data().data ?? '',
        materie: d.data().materie ?? '',
        clasa: d.data().clasa ?? '',
        timestamp: d.data().timestamp?.toDate() ?? new Date(),
      })).sort((a, b) => b.data.localeCompare(a.data));
      setRecords(data);
    } catch {}
    setRecordsLoading(false);
  }, [user?.email]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // When a teacher QR is detected (materie param in URL), run pre-check
  useEffect(() => {
    if (!teacher || !profile) return;
    setRegState('checking');

    const lockRef = doc(db, 'settings', 'lock');
    const unsubLock = onSnapshot(lockRef, async lockSnap => {
      const isLocked = lockSnap.exists() ? lockSnap.data()[teacher.id] === true : false;
      if (isLocked) { setRegState('locked'); return; }

      const clasa = clasaFromQR || profile.clasa;
      const docId = buildDocId(profile.prenume, profile.nume, clasa, today, teacher.id);
      try {
        const existing = await getDoc(doc(db, 'prezenta', docId));
        setRegState(existing.exists() ? 'already' : 'ready');
      } catch {
        setRegState('error');
      }
    }, () => setRegState('error'));

    return () => unsubLock();
  }, [teacher?.id, profile, clasaFromQR, today]);

  async function handleRegister() {
    if (!profile || !teacher || !user) return;
    setRegState('submitting');

    const clasa = clasaFromQR || profile.clasa;
    const docId = buildDocId(profile.prenume, profile.nume, clasa, today, teacher.id);

    let ip = 'necunoscut';
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      ip = (await res.json()).ip ?? 'necunoscut';
    } catch {}

    try {
      await setDoc(doc(db, 'prezenta', docId), {
        prenume: profile.prenume,
        nume: profile.nume,
        clasa,
        data: today,
        timestamp: Timestamp.now(),
        ip,
        email: user.email,
        materie: teacher.subject,
      });
      setRegState('done');
      loadRecords();
    } catch {
      setRegState('error');
    }
  }

  // QR Scanner modal
  useEffect(() => {
    if (!scannerOpen) return;
    let scanner: any;

    import('html5-qrcode').then(({ Html5QrcodeScanner }) => {
      scanner = new Html5QrcodeScanner(
        'sd-qr-reader',
        { fps: 10, qrbox: { width: 260, height: 260 } },
        false,
      );
      scanner.render(
        (decodedText: string) => {
          scanner.clear().catch(() => {});
          setScannerOpen(false);
          try {
            const url = new URL(decodedText);
            const m = url.searchParams.get('materie');
            const c = url.searchParams.get('clasa');
            if (m) {
              const params: Record<string, string> = { materie: m };
              if (c) params.clasa = c;
              setSearchParams(params);
            }
          } catch {}
        },
        () => {},
      );
      scannerRef.current = scanner;
    });

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [scannerOpen]);

  // Derived stats
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

  const dateStr = new Date().toLocaleDateString('ro-RO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  if (profileLoading) {
    return (
      <div className="page-center">
        <div style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>Se încarcă...</div>
      </div>
    );
  }

  return (
    <div className="sd-page">
      {/* ── Header ── */}
      <header className="sd-header">
        <div className="sd-header-inner">
          <div className="sd-header-logo">
            <span className="sd-logo-icon">🎓</span>
            <div>
              <div className="sd-logo-title">Prezență</div>
              <div className="sd-logo-sub">LT Ion Pelivan</div>
            </div>
          </div>

          {profile && (
            <div className="sd-header-user">
              <div className="sd-user-avatar">
                {profile.prenume.charAt(0).toUpperCase()}
              </div>
              <div className="sd-user-info">
                <span className="sd-user-name">{profile.prenume} {profile.nume}</span>
                <span className="sd-user-class">Clasa {profile.clasa}</span>
              </div>
            </div>
          )}

          <div className="sd-header-actions">
            <button className="btn-dark-toggle" onClick={() => setDarkMode(d => !d)} title="Schimbă tema">
              {darkMode ? '☀' : '🌙'}
            </button>
            <button className="sd-logout-btn" onClick={() => signOut(auth)}>
              Ieșire
            </button>
          </div>
        </div>
      </header>

      <main className="sd-main">

        {/* ── QR registration card (when URL has materie param) ── */}
        {teacher ? (
          <div className="sd-qr-card">
            {regState === 'checking' && (
              <div className="sd-reg-loading">Se verifică prezența...</div>
            )}

            {regState === 'already' && (
              <div className="sd-reg-result sd-reg-already">
                <div className="sd-reg-result-icon">✓</div>
                <div className="sd-reg-result-title">Prezență deja marcată</div>
                <div className="sd-reg-result-sub">Ai înregistrat prezența la {teacher.subject} astăzi.</div>
                <button className="sd-back-btn" onClick={() => setSearchParams({})}>← Înapoi la dashboard</button>
              </div>
            )}

            {regState === 'locked' && (
              <div className="sd-reg-result sd-reg-locked">
                <div className="sd-reg-result-icon">🔒</div>
                <div className="sd-reg-result-title">Înregistrare blocată</div>
                <div className="sd-reg-result-sub">Profesorul a închis înregistrarea prezentei.</div>
                <button className="sd-back-btn" onClick={() => setSearchParams({})}>← Înapoi la dashboard</button>
              </div>
            )}

            {regState === 'done' && (
              <div className="sd-reg-result sd-reg-done">
                <div className="sd-reg-result-icon">✓</div>
                <div className="sd-reg-result-title">Prezență înregistrată!</div>
                <div className="sd-reg-result-sub">{teacher.subject} · {dateStr}</div>
                <button className="sd-back-btn" onClick={() => setSearchParams({})}>← Înapoi la dashboard</button>
              </div>
            )}

            {regState === 'error' && (
              <div className="sd-reg-result sd-reg-error">
                <div className="sd-reg-result-icon">!</div>
                <div className="sd-reg-result-title">Eroare de conexiune</div>
                <div className="sd-reg-result-sub">Verificați conexiunea și reîncercați.</div>
                <button className="sd-back-btn" onClick={() => setSearchParams({})}>← Înapoi</button>
              </div>
            )}

            {(regState === 'ready' || regState === 'submitting') && profile && (
              <div className="sd-reg-confirm">
                <div className="sd-reg-subject-label">Ora de</div>
                <div className="sd-reg-subject-name">{teacher.subject}</div>
                <div className="sd-reg-confirm-meta">
                  <span>{profile.prenume} {profile.nume}</span>
                  <span>·</span>
                  <span>Clasa {clasaFromQR || profile.clasa}</span>
                  <span>·</span>
                  <span>{dateStr}</span>
                </div>
                <button
                  className="sd-reg-btn"
                  onClick={handleRegister}
                  disabled={regState === 'submitting'}
                >
                  {regState === 'submitting' ? 'Se înregistrează...' : '✓  Marchează prezența'}
                </button>
                <button className="sd-back-btn" style={{ marginTop: 8 }} onClick={() => setSearchParams({})}>
                  Anulează
                </button>
              </div>
            )}
          </div>
        ) : (
          /* ── Scan QR button ── */
          <button className="sd-scan-btn" onClick={() => setScannerOpen(true)}>
            <span className="sd-scan-icon">📷</span>
            <span>Scanează codul QR al profesorului</span>
          </button>
        )}

        {/* ── Stats by subject ── */}
        {subjectEntries.length > 0 && (
          <>
            <div className="sd-section-title">Prezențe per materie</div>
            <div className="sd-subjects-card">
              {subjectEntries.map(([subject, count]) => (
                <div className="pm-subject-row" key={subject}>
                  <span className="pm-subject-name">{subject}</span>
                  <div className="pm-subject-bar-track">
                    <div className="pm-subject-bar-fill" style={{ width: `${(count / maxCount) * 100}%` }} />
                  </div>
                  <span className="pm-subject-count">{count} {count === 1 ? 'zi' : 'zile'}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── History ── */}
        <div className="sd-section-title">
          Istoricul prezenței
          {records.length > 0 && (
            <span className="sd-total-badge">{records.length} total</span>
          )}
        </div>

        {recordsLoading ? (
          <div className="sd-loading-text">Se încarcă istoricul...</div>
        ) : records.length === 0 ? (
          <div className="empty-state">Nicio prezență înregistrată încă.<br />Scanează un cod QR pentru a începe.</div>
        ) : (
          <div className="pm-records sd-history-card">
            {records.map(r => (
              <div className="pm-record-row" key={r.id}>
                <div className="pm-record-date">{fmtDate(r.data)}</div>
                <div className="pm-record-badges">
                  <span className="badge">{r.clasa}</span>
                  {r.materie && (
                    <span className="badge" style={{ background: 'var(--green-light)', color: 'var(--green)' }}>
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
        )}
      </main>

      {/* ── QR Scanner modal ── */}
      {scannerOpen && (
        <div className="modal-overlay" onClick={() => setScannerOpen(false)}>
          <div className="sd-scanner-modal" onClick={e => e.stopPropagation()}>
            <div className="sd-scanner-header">
              <span>Scanează codul QR</span>
              <button className="qr-zoom-close" onClick={() => setScannerOpen(false)}>✕</button>
            </div>
            <div id="sd-qr-reader" />
            <p className="sd-scanner-hint">Îndreaptă camera spre codul QR afișat de profesor</p>
          </div>
        </div>
      )}
    </div>
  );
}
