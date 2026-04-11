import { useState, useEffect } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { useConfig } from '../hooks/useConfig';

type AuthMode = 'login' | 'register';

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
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  function switchMode(m: AuthMode) {
    setMode(m);
    setError('');
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Completează toate câmpurile.'); return; }
    setLoading(true);
    try {
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
    } catch (err: any) {
      setError(authErrorMsg(err.code));
    } finally {
      setLoading(false);
    }
  }

  const gimnClasses = classes.filter(c => /^(V|VI|VII|VIII|IX)-/.test(c));
  const liceuClasses = classes.filter(c => /^(X|XI|XII)-/.test(c));
  const otherClasses = classes.filter(c => !gimnClasses.includes(c) && !liceuClasses.includes(c));

  return (
    <div className="page-center">
      <div className="card" style={{ maxWidth: 440 }}>
        <div className="card-header" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)' }}>
          <div className="school-icon">🎓</div>
          <h1>LT Ion Pelivan</h1>
          <p className="subtitle">Sistem de Prezență</p>
        </div>

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

        {mode === 'login' ? (
          <form onSubmit={handleLogin} className="form">
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
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Se conectează...' : 'Conectare'}
            </button>
            <p className="auth-switch-hint">
              Nu ai cont?{' '}
              <button type="button" className="auth-link" onClick={() => switchMode('register')}>
                Creează unul
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleRegister} className="form">
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

        <div style={{ padding: '0 28px 16px', textAlign: 'right' }}>
          <button className="btn-dark-toggle" onClick={() => setDarkMode(d => !d)}>
            {darkMode ? '☀ Mod luminos' : '🌙 Mod întunecat'}
          </button>
        </div>
      </div>
    </div>
  );
}
