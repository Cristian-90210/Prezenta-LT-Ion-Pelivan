import { useState, useEffect } from 'react';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail,
  signInWithPopup, GoogleAuthProvider,
  browserLocalPersistence, browserSessionPersistence, setPersistence,
} from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useConfig } from '../hooks/useConfig';

type AuthMode = 'login' | 'register' | 'reset';

function authErrorMsg(code: string): string {
  switch (code) {
    case 'auth/invalid-email': return 'Adresă de email invalidă.';
    case 'auth/user-not-found': return 'Nu există un cont cu această adresă.';
    case 'auth/wrong-password': return 'Parolă incorectă.';
    case 'auth/email-already-in-use': return 'Există deja un cont cu această adresă de email.';
    case 'auth/weak-password': return 'Parola trebuie să aibă cel puțin 6 caractere.';
    case 'auth/invalid-credential': return 'Email sau parolă incorectă.';
    case 'auth/too-many-requests': return 'Prea multe încercări. Încearcă mai târziu.';
    default: return 'Eroare la autentificare. Încearcă din nou.';
  }
}

export default function AuthPage() {
  const { classes } = useConfig();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [prenume, setPrenume] = useState('');
  const [nume, setNume] = useState('');
  const [clasa, setClasa] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => localStorage.getItem('rememberMe') === 'true');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') !== 'false');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  function switchMode(m: AuthMode) {
    setMode(m);
    setError('');
    setResetSent(false);
  }

  function handleRememberChange(val: boolean) {
    setRememberMe(val);
    localStorage.setItem('rememberMe', String(val));
  }

  async function applyPersistence() {
    const p = rememberMe ? browserLocalPersistence : browserSessionPersistence;
    await setPersistence(auth, p);
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim()) { setError('Introduceți adresa de email.'); return; }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim().toLowerCase());
      setResetSent(true);
    } catch (err: any) {
      setError(authErrorMsg(err.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError('');
    setLoading(true);
    try {
      await applyPersistence();
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      // Dacă e utilizator nou, creăm profilul din datele Google
      const profileRef = doc(db, 'students', cred.user.uid);
      const existing = await getDoc(profileRef);
      if (!existing.exists()) {
        const parts = (cred.user.displayName ?? '').trim().split(' ');
        const prenume = parts[0] ?? '';
        const restNume = parts.slice(1).join(' ');
        await setDoc(profileRef, {
          prenume,
          nume: restNume,
          clasa: '',
          email: cred.user.email ?? '',
        });
      }
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setError(authErrorMsg(err.code));
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Completează toate câmpurile.'); return; }
    setLoading(true);
    try {
      await applyPersistence();
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    } catch (err: any) {
      setError(authErrorMsg(err.code));
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!prenume.trim() || !nume.trim() || !email.trim() || !password || !clasa) {
      setError('Completează toate câmpurile.');
      return;
    }
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password,
      );
      await setDoc(doc(db, 'students', cred.user.uid), {
        prenume: prenume.trim(),
        nume: nume.trim(),
        clasa,
        email: email.trim().toLowerCase(),
      });
      // Trimite email de verificare — ignorăm eroarea dacă eșuează (cont creat oricum)
      sendEmailVerification(cred.user).catch(() => {});
    } catch (err: any) {
      setError(authErrorMsg(err.code));
    } finally {
      setLoading(false);
    }
  }

  const gimnClasses = classes.filter(c => /^(V|VI|VII|VIII|IX)-/.test(c));
  const liceuClasses = classes.filter(c => /^(X|XI|XII)-/.test(c));
  const otherClasses = classes.filter(c => !gimnClasses.includes(c) && !liceuClasses.includes(c));

  const googleIcon = (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path fill="#4285F4" d="M44.5 20H24v8.5h11.7C34.2 33.9 29.6 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.6 20-21 0-1.4-.1-2.7-.5-4z"/>
      <path fill="#34A853" d="M6.3 14.7l7 5.1C15.1 16.1 19.2 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3c-7.7 0-14.3 4.4-17.7 11.7z"/>
      <path fill="#FBBC05" d="M24 45c5.5 0 10.5-1.9 14.3-5l-6.6-5.4C29.6 36.1 27 37 24 37c-5.6 0-10.2-3.1-11.7-7.5l-7 5.4C8.7 41.6 15.8 45 24 45z"/>
      <path fill="#EA4335" d="M44.5 20H24v8.5h11.7c-.8 2.2-2.3 4.1-4.3 5.4l6.6 5.4C41.9 36.2 45 30.6 45 24c0-1.4-.1-2.7-.5-4z"/>
    </svg>
  );

  return (
    <div className="auth-page">

      {/* ── Brand deasupra cardului ── */}
      <div className="auth-brand">
        <span className="auth-brand-icon">🎓</span>
        <span className="auth-brand-name">LT Ion Pelivan</span>
      </div>

      <div className="auth-card">

        {mode === 'reset' ? (
          /* ── Reset parolă ── */
          <div className="auth-inner">
            <h2 className="auth-title">Resetare parolă</h2>
            {resetSent ? (
              <div className="reset-success">
                <div className="reset-success-icon">📧</div>
                <p className="reset-success-title">Email trimis!</p>
                <p className="reset-success-sub">
                  Verifică inbox-ul la <strong>{email}</strong> și urmează instrucțiunile.
                </p>
                <button className="btn-primary" onClick={() => switchMode('login')}>
                  ← Înapoi la conectare
                </button>
              </div>
            ) : (
              <>
                <p className="auth-subtitle">Introduceți adresa de email pentru a primi linkul de resetare.</p>
                <form onSubmit={handleReset} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <div className="field">
                    <label htmlFor="reset-email">Email</label>
                    <input
                      id="reset-email"
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="ion.popescu@scoala.ro"
                      autoComplete="email"
                      autoFocus
                      disabled={loading}
                    />
                  </div>
                  {error && <p className="error-msg">{error}</p>}
                  <button type="submit" className="btn-primary" disabled={loading}>
                    {loading ? 'Se trimite...' : 'Trimite link de resetare'}
                  </button>
                </form>
                <p className="auth-switch-hint" style={{ marginTop: 16 }}>
                  <button type="button" className="auth-link" onClick={() => switchMode('login')}>
                    ← Înapoi la conectare
                  </button>
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="auth-inner">
            <h2 className="auth-title">
              {mode === 'login' ? 'Bun venit!' : 'Creează cont'}
            </h2>
            <p className="auth-subtitle">Sistem de Prezență · LT Ion Pelivan</p>

            {/* ── Buton Google proeminent ── */}
            <button
              className="btn-google-hero"
              onClick={handleGoogleSignIn}
              disabled={loading}
              type="button"
            >
              {googleIcon}
              Continuă cu Google
            </button>

            {/* ── Separator ── */}
            <div className="auth-sep">
              <span className="auth-sep-line" />
              <span className="auth-sep-text">sau cu email</span>
              <span className="auth-sep-line" />
            </div>

            {/* ── Tabs ── */}
            <div className="auth-tabs">
              <button
                className={`auth-tab${mode === 'login' ? ' active' : ''}`}
                onClick={() => switchMode('login')}
              >
                Conectare
              </button>
              <button
                className={`auth-tab${mode === 'register' ? ' active' : ''}`}
                onClick={() => switchMode('register')}
              >
                Cont nou
              </button>
            </div>

            {/* ── Formular conectare ── */}
            {mode === 'login' && (
              <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
                <div className="field">
                  <label htmlFor="auth-email">Email</label>
                  <input
                    id="auth-email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="ion.popescu@scoala.ro"
                    autoComplete="email"
                    autoFocus
                    disabled={loading}
                  />
                </div>
                <div className="field">
                  <label htmlFor="auth-pass">Parolă</label>
                  <input
                    id="auth-pass"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    disabled={loading}
                  />
                </div>
                {error && <p className="error-msg">{error}</p>}
                <label className="remember-me-row">
                  <input
                    type="checkbox"
                    className="remember-me-check"
                    checked={rememberMe}
                    onChange={e => handleRememberChange(e.target.checked)}
                  />
                  <span>Ține-mă minte</span>
                </label>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Se conectează...' : 'Conectare'}
                </button>
                <p className="auth-switch-hint">
                  <button type="button" className="auth-link" onClick={() => switchMode('reset')}>
                    Am uitat parola
                  </button>
                  {' · '}
                  Nu ai cont?{' '}
                  <button type="button" className="auth-link" onClick={() => switchMode('register')}>
                    Creează unul
                  </button>
                </p>
              </form>
            )}

            {/* ── Formular înregistrare ── */}
            {mode === 'register' && (
              <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 20 }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="reg-prenume">Prenume</label>
                    <input
                      id="reg-prenume"
                      type="text"
                      value={prenume}
                      onChange={e => setPrenume(e.target.value)}
                      placeholder="Ion"
                      autoComplete="given-name"
                      autoFocus
                      disabled={loading}
                    />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label htmlFor="reg-nume">Nume</label>
                    <input
                      id="reg-nume"
                      type="text"
                      value={nume}
                      onChange={e => setNume(e.target.value)}
                      placeholder="Popescu"
                      autoComplete="family-name"
                      disabled={loading}
                    />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="reg-email">Email</label>
                  <input
                    id="reg-email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="ion.popescu@scoala.ro"
                    autoComplete="email"
                    disabled={loading}
                  />
                </div>
                <div className="field">
                  <label htmlFor="reg-pass">Parolă</label>
                  <input
                    id="reg-pass"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Minim 6 caractere"
                    autoComplete="new-password"
                    disabled={loading}
                  />
                </div>
                <div className="field">
                  <label htmlFor="reg-clasa">Clasa</label>
                  <select
                    id="reg-clasa"
                    value={clasa}
                    onChange={e => setClasa(e.target.value)}
                    disabled={loading}
                  >
                    <option value="">— Alege clasa —</option>
                    {gimnClasses.length > 0 && (
                      <optgroup label="Clasele V–IX">
                        {gimnClasses.map(c => <option key={c} value={c}>{c}</option>)}
                      </optgroup>
                    )}
                    {liceuClasses.length > 0 && (
                      <optgroup label="Clasele X–XII">
                        {liceuClasses.map(c => <option key={c} value={c}>{c}</option>)}
                      </optgroup>
                    )}
                    {otherClasses.length > 0 && (
                      <optgroup label="Altele">
                        {otherClasses.map(c => <option key={c} value={c}>{c}</option>)}
                      </optgroup>
                    )}
                  </select>
                </div>
                {error && <p className="error-msg">{error}</p>}
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Se creează contul...' : 'Creează cont'}
                </button>
                <p className="auth-switch-hint">
                  Ai deja cont?{' '}
                  <button type="button" className="auth-link" onClick={() => switchMode('login')}>
                    Conectează-te
                  </button>
                </p>
              </form>
            )}
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="auth-footer">
        <button className="btn-dark-toggle" onClick={() => setDarkMode(d => !d)}>
          {darkMode ? '☀ Mod luminos' : '🌙 Mod întunecat'}
        </button>
      </div>
    </div>
  );
}
