import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { signOut, sendEmailVerification } from 'firebase/auth';
import {
  collection, query, where, getDocs, getDoc,
  doc, setDoc, Timestamp, onSnapshot,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useConfig } from '../hooks/useConfig';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { useStudentPhoto } from '../hooks/useProfilePhoto';
import { useAttendanceNotifications } from '../hooks/useAttendanceNotifications';
import CropModal from '../components/CropModal';

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
type StudentTab = 'scan' | 'istoric' | 'profil';

function buildDocId(prenume: string, nume: string, clasa: string, data: string, materieId: string): string {
  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9._-]/g, '_');
  return `${normalize(prenume)}|${normalize(nume)}|${clasa.toLowerCase()}|${data}${materieId ? `|${materieId}` : ''}`;
}

const TAB_ITEMS: { id: StudentTab; icon: string; label: string }[] = [
  { id: 'scan',    icon: '📷', label: 'Scanează QR' },
  { id: 'istoric', icon: '📋', label: 'Prezența mea' },
  { id: 'profil',  icon: '👤', label: 'Profilul meu' },
];

export default function StudentDashboardPage() {
  const { user } = useAuth();
  const { teachers, classes } = useConfig();
  const [searchParams, setSearchParams] = useSearchParams();

  const materieId   = searchParams.get('materie') ?? '';
  const clasaFromQR = searchParams.get('clasa')   ?? '';
  const teacher     = teachers.find(t => t.id === materieId) ?? null;

  const [profile, setProfile]               = useState<StudentProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [records, setRecords]               = useState<AttRec[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);

  const [regState, setRegState]       = useState<RegState>('idle');
  const [dashTab, setDashTab]         = useState<StudentTab>('scan');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const scannerRef = useRef<any>(null);

  const [verifSent, setVerifSent]         = useState(false);
  const [verifLoading, setVerifLoading]   = useState(false);

  // Editare profil
  const [editPrenume, setEditPrenume]   = useState('');
  const [editNume, setEditNume]         = useState('');
  const [editClasa, setEditClasa]       = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg]     = useState('');

  const isOnline = useOnlineStatus();
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');
  const { photoURL, saving: photoSaving, error: photoError, savePhoto } = useStudentPhoto(user?.uid);

  // Foto pending (crop confirmat dar nesalvat încă)
  const [pendingPhoto, setPendingPhoto]   = useState<string | null>(null);
  const [cropFile,     setCropFile]       = useState<File | null>(null);

  // ── Notificări push ───────────────────────────────────────────────────────
  const notifSupported = typeof window !== 'undefined' && 'Notification' in window;
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    notifSupported ? Notification.permission : 'denied'
  );
  const [notifDismissed, setNotifDismissed] = useState(
    () => localStorage.getItem('notifDismissed') === 'true'
  );

  async function requestNotifPermission() {
    const result = await Notification.requestPermission();
    setNotifPermission(result);
    if (result === 'denied') {
      localStorage.setItem('notifDismissed', 'true');
      setNotifDismissed(true);
    }
  }

  function dismissNotifBanner() {
    localStorage.setItem('notifDismissed', 'true');
    setNotifDismissed(true);
  }

  useAttendanceNotifications(teachers);

  // ── Auto-logout după 10 minute (persistent prin sessionStorage) ──────────
  useEffect(() => {
    if (!user) {
      sessionStorage.removeItem('studentLoginTime');
      return;
    }
    const TIMEOUT = 10 * 60 * 1000;
    const stored = sessionStorage.getItem('studentLoginTime');
    const loginTime = stored ? Number(stored) : Date.now();
    if (!stored) sessionStorage.setItem('studentLoginTime', String(loginTime));

    const checkAndLogout = () => {
      if (Date.now() - loginTime >= TIMEOUT) signOut(auth);
    };

    const remaining = TIMEOUT - (Date.now() - loginTime);
    if (remaining <= 0) { signOut(auth); return; }

    const timer = setTimeout(() => signOut(auth), remaining);
    // Pe mobil, timer-ul e înghețat în background — verificăm când revine în prim plan
    document.addEventListener('visibilitychange', checkAndLogout);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', checkAndLogout);
    };
  }, [user]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // Când vine un QR param, forțează tab-ul scan (fără a suprascrie localStorage)
  useEffect(() => {
    if (materieId) setDashTab('scan');
  }, [materieId]);

  const today = new Date().toISOString().split('T')[0];

  // ── Profil elev ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, 'students', user.uid)).then(snap => {
      if (snap.exists()) {
        const p = snap.data() as StudentProfile;
        setProfile(p);
        setEditPrenume(p.prenume);
        setEditNume(p.nume);
        setEditClasa(p.clasa);
      }
      setProfileLoading(false);
    }).catch(() => setProfileLoading(false));
  }, [user]);

  // ── Înregistrări prezență ────────────────────────────────────────────────
  const loadRecords = useCallback(async () => {
    if (!user?.email) return;
    setRecordsLoading(true);
    try {
      const q = query(collection(db, 'prezenta'), where('email', '==', user.email));
      const snap = await getDocs(q);
      const data: AttRec[] = snap.docs.map(d => ({
        id:        d.id,
        data:      d.data().data      ?? '',
        materie:   d.data().materie   ?? '',
        clasa:     d.data().clasa     ?? '',
        timestamp: d.data().timestamp?.toDate() ?? new Date(),
      })).sort((a, b) => b.data.localeCompare(a.data));
      setRecords(data);
    } catch {}
    setRecordsLoading(false);
  }, [user?.email]);

  useEffect(() => { loadRecords(); }, [loadRecords]);

  // ── Verificare prezență când vine QR param ───────────────────────────────
  useEffect(() => {
    if (!teacher || !profile) return;
    setRegState('checking');

    const lockRef = doc(db, 'settings', 'lock');
    const unsub = onSnapshot(lockRef, async lockSnap => {
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

    return () => unsub();
  }, [teacher?.id, profile, clasaFromQR, today]);

  async function handleResendVerification() {
    if (!user || verifLoading) return;
    setVerifLoading(true);
    try {
      await sendEmailVerification(user);
      setVerifSent(true);
    } catch {}
    setVerifLoading(false);
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !profile) return;
    const prenume = editPrenume.trim();
    const nume    = editNume.trim();
    if (!prenume || !nume || !editClasa) {
      setProfileMsg('Completează toate câmpurile.');
      return;
    }
    setProfileSaving(true);
    setProfileMsg('');
    try {
      // Salvează datele profilului
      const updated: StudentProfile = { ...profile, prenume, nume, clasa: editClasa };
      await setDoc(doc(db, 'students', user.uid), updated);
      setProfile(updated);
      // Salvează poza pending (dacă există)
      if (pendingPhoto) {
        const ok = await savePhoto(pendingPhoto);
        if (ok) setPendingPhoto(null);
      }
      setProfileMsg('✓ Profilul a fost actualizat!');
    } catch {
      setProfileMsg('Eroare la salvare. Încearcă din nou.');
    }
    setProfileSaving(false);
    setTimeout(() => setProfileMsg(''), 4000);
  }

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
        prenume:   profile.prenume,
        nume:      profile.nume,
        clasa,
        data:      today,
        timestamp: Timestamp.now(),
        ip,
        email:     user.email,
        materie:   teacher.subject,
      });
      setRegState('done');
      loadRecords();
    } catch {
      setRegState('error');
    }
  }

  // ── QR Scanner ───────────────────────────────────────────────────────────
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
            const m   = url.searchParams.get('materie');
            const c   = url.searchParams.get('clasa');
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

  // ── Date derivate pentru statistici ─────────────────────────────────────
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

  function goTab(tab: StudentTab) {
    setDashTab(tab);
    setSidebarOpen(false);
  }

  if (profileLoading) {
    return (
      <div className="page-center">
        <div style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>Se încarcă...</div>
      </div>
    );
  }

  // Profilul lipsă (utilizator nou via Google) — completare obligatorie
  if (!profile) {
    return (
      <div className="page-center">
        <div className="card" style={{ maxWidth: 440 }}>
          <div className="card-header" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)' }}>
            <div className="school-icon">🎓</div>
            <h1>Completează profilul</h1>
            <p className="subtitle">Câteva detalii pentru a finaliza înregistrarea</p>
          </div>
          <form
            className="form"
            onSubmit={async e => {
              e.preventDefault();
              const prenume = editPrenume.trim();
              const nume    = editNume.trim();
              if (!prenume || !nume || !editClasa) {
                setProfileMsg('Completează toate câmpurile.');
                return;
              }
              setProfileSaving(true);
              setProfileMsg('');
              try {
                const data = { prenume, nume, clasa: editClasa, email: user!.email ?? '' };
                await setDoc(doc(db, 'students', user!.uid), data);
                setProfile(data);
              } catch {
                setProfileMsg('Eroare la salvare. Încearcă din nou.');
              }
              setProfileSaving(false);
            }}
          >
            <div style={{ display: 'flex', gap: 12 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Prenume</label>
                <input
                  type="text"
                  value={editPrenume}
                  onChange={e => setEditPrenume(e.target.value)}
                  placeholder="Ion"
                  autoFocus
                  disabled={profileSaving}
                />
              </div>
              <div className="field" style={{ flex: 1 }}>
                <label>Nume de familie</label>
                <input
                  type="text"
                  value={editNume}
                  onChange={e => setEditNume(e.target.value)}
                  placeholder="Popescu"
                  disabled={profileSaving}
                />
              </div>
            </div>
            <div className="field">
              <label>Clasa</label>
              <select value={editClasa} onChange={e => setEditClasa(e.target.value)} disabled={profileSaving}>
                <option value="">— Alege clasa —</option>
                {(() => {
                  const gimn  = classes.filter(c => /^(V|VI|VII|VIII|IX)-/.test(c));
                  const liceu = classes.filter(c => /^(X|XI|XII)-/.test(c));
                  const alte  = classes.filter(c => !gimn.includes(c) && !liceu.includes(c));
                  return (
                    <>
                      {gimn.length  > 0 && <optgroup label="Clasele V–IX">{gimn.map(c  => <option key={c} value={c}>{c}</option>)}</optgroup>}
                      {liceu.length > 0 && <optgroup label="Clasele X–XII">{liceu.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>}
                      {alte.length  > 0 && <optgroup label="Altele">{alte.map(c        => <option key={c} value={c}>{c}</option>)}</optgroup>}
                    </>
                  );
                })()}
              </select>
            </div>
            {profileMsg && <p className="error-msg">{profileMsg}</p>}
            <button type="submit" className="btn-primary" disabled={profileSaving}>
              {profileSaving ? 'Se salvează...' : 'Salvează și continuă'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="teacher-page">

      {/* ══════════ SIDEBAR MOBIL ══════════ */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}>
          <div className="sidebar" onClick={e => e.stopPropagation()}>

            <div className="sidebar-header">
              <span className="sidebar-logo">🎓 LT Ion Pelivan</span>
              <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>✕</button>
            </div>

            {/* Profil elev */}
            {profile && (
              <div className="sidebar-profile">
                <div className="sidebar-avatar">
                  {profile.prenume.charAt(0).toUpperCase()}
                </div>
                <div className="sidebar-profile-info">
                  <span className="sidebar-profile-name">{profile.prenume} {profile.nume}</span>
                  <span className="sidebar-profile-sub">Clasa {profile.clasa}</span>
                  <span className="sidebar-badge">Elev</span>
                </div>
              </div>
            )}

            {/* Navigare */}
            <nav className="sidebar-nav">
              {TAB_ITEMS.map(item => (
                <button
                  key={item.id}
                  className={`sidebar-nav-item${dashTab === item.id ? ' active' : ''}`}
                  onClick={() => goTab(item.id)}
                >
                  <span className="sidebar-nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>

            {/* Footer */}
            <div className="sidebar-footer">
              <div className="sidebar-toggle-row">
                <span className="sidebar-toggle-label">🌙 Mod întunecat</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={darkMode}
                    onChange={() => setDarkMode(d => !d)}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>
              <button className="sidebar-logout" onClick={() => signOut(auth)}>
                ↩ Deconectare
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ══════════ END SIDEBAR ══════════ */}

      {/* ── Header ── */}
      <header className="teacher-header">
        <div className="header-content">
          <button className="btn-hamburger" onClick={() => setSidebarOpen(true)}>☰</button>
          <div className="header-center-title">
            <span className="hct-subject">Prezență</span>
            <span className="hct-school">LT Ion Pelivan</span>
          </div>
          <button
            className="header-profile-btn"
            onClick={() => goTab('profil')}
            title="Profilul meu"
            aria-label="Profilul meu"
          >
            {photoURL
              ? <img src={photoURL} alt="avatar" />
              : (profile?.prenume?.charAt(0).toUpperCase() ?? '👤')
            }
          </button>
        </div>
      </header>

      {/* ── Banner notificări ── */}
      {notifSupported && notifPermission === 'default' && !notifDismissed && (
        <div style={{
          background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
          color: '#fff',
          padding: '10px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          fontSize: '0.85rem',
          flexWrap: 'wrap',
        }}>
          <span style={{ flex: 1 }}>
            🔔 Activează notificările pentru a fi anunțat când profesorul deschide prezența.
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={requestNotifPermission}
              style={{
                background: '#fff', color: '#2563eb', border: 'none',
                borderRadius: 6, padding: '5px 14px', fontWeight: 700,
                cursor: 'pointer', fontSize: '0.82rem',
              }}
            >
              Activează
            </button>
            <button
              onClick={dismissNotifBanner}
              style={{
                background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.5)',
                borderRadius: 6, padding: '5px 10px', cursor: 'pointer', fontSize: '0.82rem',
              }}
            >
              Nu acum
            </button>
          </div>
        </div>
      )}

      {notifSupported && notifPermission === 'granted' && !notifDismissed && (
        <div style={{
          background: '#f0fdf4', color: '#16a34a', padding: '8px 16px',
          fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 8,
        }}
          onClick={() => setNotifDismissed(true)}
        >
          ✓ Notificări activate — vei fi anunțat când prezența se deschide sau se închide.
        </div>
      )}

      <div className="teacher-body">

        {/* ══ SIDEBAR PERMANENT (desktop) ══ */}
        <aside className="teacher-sidebar-fixed">
          {profile && (
            <div className="tsf-profile">
              <div className="tsf-avatar">{profile.prenume.charAt(0).toUpperCase()}</div>
              <div className="tsf-info">
                <span className="tsf-name">{profile.prenume} {profile.nume}</span>
                <span className="tsf-badge">Clasa {profile.clasa}</span>
              </div>
            </div>
          )}

          <nav className="tsf-nav">
            {TAB_ITEMS.map(item => (
              <button
                key={item.id}
                className={`tsf-nav-item${dashTab === item.id ? ' active' : ''}`}
                onClick={() => goTab(item.id)}
              >
                <span className="tsf-nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="tsf-footer">
            <div className="sidebar-toggle-row">
              <span className="sidebar-toggle-label">🌙 Mod întunecat</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={darkMode} onChange={() => setDarkMode(d => !d)} />
                <span className="toggle-slider" />
              </label>
            </div>
            <button className="sidebar-logout" onClick={() => signOut(auth)}>↩ Deconectare</button>
          </div>
        </aside>

        {/* ── Conținut principal ── */}
        <main className="teacher-main" style={{ paddingTop: 24 }}>

        {/* ── Banner email neverificat ── */}
        {user && !user.emailVerified && (
          <div className="alert-banner alert-banner--warning">
            <span>📧 Verifică-ți adresa de email <strong>{user.email}</strong>. Caută emailul de la Firebase.</span>
            <button
              className="alert-banner-btn"
              onClick={handleResendVerification}
              disabled={verifLoading || verifSent}
            >
              {verifSent ? '✓ Trimis!' : verifLoading ? 'Se trimite...' : 'Retrimite'}
            </button>
          </div>
        )}

        {/* ── Banner offline ── */}
        {!isOnline && (
          <div className="alert-banner alert-banner--offline">
            <span>📵 Ești offline. Prezențele se salvează local și se sincronizează automat când revine conexiunea.</span>
          </div>
        )}

        {/* ══ TAB: Scanează QR ══ */}
        {dashTab === 'scan' && (
          <>
            {teacher ? (
              /* Card înregistrare prezență (vine din QR) */
              <div className="sd-qr-card" style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
                {regState === 'checking' && (
                  <div className="sd-reg-loading">Se verifică prezența...</div>
                )}

                {regState === 'already' && (
                  <div className="sd-reg-result sd-reg-already">
                    <div className="sd-reg-result-icon">✓</div>
                    <div className="sd-reg-result-title">Prezență deja marcată</div>
                    <div className="sd-reg-result-sub">Ai înregistrat prezența la <strong>{teacher.subject}</strong> astăzi.</div>
                    <button className="sd-back-btn" onClick={() => setSearchParams({})}>← Înapoi</button>
                  </div>
                )}

                {regState === 'locked' && (
                  <div className="sd-reg-result sd-reg-locked">
                    <div className="sd-reg-result-icon">🔒</div>
                    <div className="sd-reg-result-title">Înregistrare blocată</div>
                    <div className="sd-reg-result-sub">Profesorul a închis înregistrarea prezentei.</div>
                    <button className="sd-back-btn" onClick={() => setSearchParams({})}>← Înapoi</button>
                  </div>
                )}

                {regState === 'done' && (
                  <div className="sd-reg-result sd-reg-done">
                    <div className="sd-reg-result-icon">✓</div>
                    <div className="sd-reg-result-title">Prezență înregistrată!</div>
                    <div className="sd-reg-result-sub">{teacher.subject} · {dateStr}</div>
                    <button className="sd-back-btn" onClick={() => setSearchParams({})}>← Înapoi</button>
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
              /* Buton scan QR */
              <div style={{ maxWidth: 520, margin: '0 auto', width: '100%' }}>
                <button className="sd-scan-btn" onClick={() => setScannerOpen(true)}>
                  <span className="sd-scan-icon">📷</span>
                  <span>Scanează codul QR al profesorului</span>
                </button>
                <p style={{
                  textAlign: 'center', color: 'var(--text-muted)',
                  fontSize: '0.875rem', marginTop: 16, lineHeight: 1.6,
                }}>
                  Deschide camera și îndreaptă spre codul QR afișat de profesor pentru a marca prezența automat.
                </p>
              </div>
            )}
          </>
        )}

        {/* ══ TAB: Prezența mea ══ */}
        {dashTab === 'istoric' && (
          <div style={{ maxWidth: 720, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Rezumat per materie */}
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

            {/* Istoric */}
            <div className="sd-section-title">
              Istoricul detaliat
              {records.length > 0 && (
                <span className="sd-total-badge">{records.length} total</span>
              )}
            </div>

            {recordsLoading ? (
              <div className="sd-loading-text">Se încarcă istoricul...</div>
            ) : records.length === 0 ? (
              <div className="empty-state">
                Nicio prezență înregistrată încă.<br />
                Mergi la „Scanează QR" pentru a începe.
              </div>
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
          </div>
        )}

        {/* ══ CropModal ══ */}
        {cropFile && (
          <CropModal
            file={cropFile}
            onConfirm={base64 => { setPendingPhoto(base64); setCropFile(null); }}
            onCancel={() => setCropFile(null)}
          />
        )}

        {/* ══ TAB: Profilul meu ══ */}
        {dashTab === 'profil' && profile && (
          <div style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>

            <div className="controls">
              <h3 className="admin-section-title">Editează profilul</h3>
              <form onSubmit={handleSaveProfile}>

                {/* ── Poza de profil ── */}
                <div className="photo-upload-area">
                  {pendingPhoto
                    ? <img src={pendingPhoto} alt="avatar" className="photo-preview" />
                    : photoURL
                      ? <img src={photoURL} alt="avatar" className="photo-preview" />
                      : <div className="photo-preview-placeholder">{profile.prenume.charAt(0).toUpperCase()}</div>
                  }
                  <div className="photo-upload-info">
                    <label className="photo-upload-label">
                      {pendingPhoto ? '✓ Poză selectată — schimbă' : photoURL ? 'Schimbă poza' : 'Adaugă poza'}
                      <input
                        type="file"
                        accept="image/*"
                        disabled={profileSaving}
                        onChange={e => { const f = e.target.files?.[0]; if (f) setCropFile(f); e.target.value = ''; }}
                      />
                    </label>
                    <span className="photo-upload-hint">
                      {pendingPhoto ? 'Poza va fi salvată când apeși „Salvează modificările"' : 'JPG, PNG · ajustare circulară'}
                    </span>
                    {photoError && <span style={{ color: 'var(--rose)', fontSize: '0.8rem' }}>{photoError}</span>}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="ep-prenume">Prenume</label>
                    <input
                      id="ep-prenume"
                      type="text"
                      value={editPrenume}
                      onChange={e => setEditPrenume(e.target.value)}
                      disabled={profileSaving}
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="ep-nume">Nume de familie</label>
                    <input
                      id="ep-nume"
                      type="text"
                      value={editNume}
                      onChange={e => setEditNume(e.target.value)}
                      disabled={profileSaving}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="ep-clasa">Clasa</label>
                  <select
                    id="ep-clasa"
                    value={editClasa}
                    onChange={e => setEditClasa(e.target.value)}
                    disabled={profileSaving}
                  >
                    <option value="">— Alege clasa —</option>
                    {(() => {
                      const gimn  = classes.filter(c => /^(V|VI|VII|VIII|IX)-/.test(c));
                      const liceu = classes.filter(c => /^(X|XI|XII)-/.test(c));
                      const alte  = classes.filter(c => !gimn.includes(c) && !liceu.includes(c));
                      return (
                        <>
                          {gimn.length  > 0 && <optgroup label="Clasele V–IX">{gimn.map(c  => <option key={c} value={c}>{c}</option>)}</optgroup>}
                          {liceu.length > 0 && <optgroup label="Clasele X–XII">{liceu.map(c => <option key={c} value={c}>{c}</option>)}</optgroup>}
                          {alte.length  > 0 && <optgroup label="Altele">{alte.map(c        => <option key={c} value={c}>{c}</option>)}</optgroup>}
                        </>
                      );
                    })()}
                  </select>
                </div>

                <div className="field">
                  <label>Email</label>
                  <input
                    type="email"
                    value={profile.email}
                    disabled
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                  />
                  <span className="field-hint">Emailul nu poate fi modificat.</span>
                </div>

                {profileMsg && (
                  <p
                    className={profileMsg.startsWith('✓') ? 'success-msg' : 'error-msg'}
                    style={{ marginBottom: 8 }}
                  >
                    {profileMsg}
                  </p>
                )}

                <button type="submit" className="btn-primary" disabled={profileSaving || photoSaving}>
                  {(profileSaving || photoSaving) ? 'Se salvează...' : 'Salvează modificările'}
                </button>
              </form>
            </div>

            {/* Info cont */}
            <div className="controls" style={{ marginTop: 0 }}>
              <h3 className="admin-section-title">Informații cont</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Email verificat</span>
                  <span style={{
                    fontWeight: 700, fontSize: '0.82rem',
                    color: user?.emailVerified ? 'var(--green)' : 'var(--rose)',
                  }}>
                    {user?.emailVerified ? '✓ Verificat' : '✗ Neverificat'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Total prezențe</span>
                  <span style={{ fontWeight: 700, color: 'var(--indigo)' }}>{records.length}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Materii frecventate</span>
                  <span style={{ fontWeight: 700, color: 'var(--indigo)' }}>{Object.keys(bySubject).length}</span>
                </div>
              </div>
            </div>

            <button
              className="sidebar-logout"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => signOut(auth)}
            >
              ↩ Deconectare
            </button>
          </div>
        )}
        </main>
      </div>

      {/* ── Scanner modal ── */}
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
