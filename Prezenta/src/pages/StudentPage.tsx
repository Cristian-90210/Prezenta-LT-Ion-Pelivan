import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Timestamp, doc, setDoc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { TEACHERS } from '../teachers';

const ALL_CLASSES_V_IX = ['V', 'VI', 'VII', 'VIII', 'IX'].flatMap(cls =>
  ['A', 'B', 'C'].map(lit => `${cls}-${lit}`)
);
const ALL_CLASSES_X_XII = ['X', 'XI', 'XII'].flatMap(cls =>
  ['REAL', 'UMAN'].map(profil => `${cls}-${profil}`)
);

type Step = 'form' | 'success' | 'error';

export default function StudentPage() {
  const [searchParams] = useSearchParams();
  const clasaFromUrl = searchParams.get('clasa') ?? '';
  const materieId = searchParams.get('materie') ?? '';
  const teacher = TEACHERS.find(t => t.id === materieId) ?? null;

  const [prenume, setPrenume] = useState('');
  const [nume, setNume] = useState('');
  const [clasa, setClasa] = useState(clasaFromUrl);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [validationError, setValidationError] = useState('');
  const [locked, setLocked] = useState(false);
  const [lockLoading, setLockLoading] = useState(!!teacher);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

  const today = new Date().toISOString().split('T')[0];

  // ── Dark mode ─────────────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // ── Lock check (real-time) ────────────────────────────────────────────────
  useEffect(() => {
    if (!teacher) { setLockLoading(false); return; }
    const lockRef = doc(db, 'settings', 'lock');
    const unsubscribe = onSnapshot(
      lockRef,
      snap => {
        setLockLoading(false);
        setLocked(snap.exists() ? snap.data()[teacher.id] === true : false);
      },
      () => setLockLoading(false)
    );
    return () => unsubscribe();
  }, [teacher?.id]);

  // ID determinist: același elev + aceeași materie + aceeași zi → același document
  function buildDocId(prenume: string, nume: string, clasa: string, data: string, materieId: string): string {
    const normalize = (s: string) =>
      s.toLowerCase()
       .normalize('NFD')
       .replace(/[\u0300-\u036f]/g, '') // elimină diacriticele
       .replace(/[^a-z0-9._-]/g, '_');
    const suffix = materieId ? `|${materieId}` : '';
    return `${normalize(prenume)}|${normalize(nume)}|${clasa.toLowerCase()}|${data}${suffix}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setValidationError('');

    const prenumeTrim = prenume.trim();
    const numeTrim = nume.trim();
    const clasaTrim = clasa.trim();

    if (!prenumeTrim || !numeTrim || !clasaTrim) {
      setValidationError('Completează toate câmpurile.');
      return;
    }

    if (locked) {
      setValidationError('Înregistrarea prezentei este momentan blocată de profesor.');
      return;
    }

    setLoading(true);

    // Verificare anti-duplicat prin ID determinist (nu depinde de index Firestore)
    const docId = buildDocId(prenumeTrim, numeTrim, clasaTrim, today, teacher?.id ?? '');
    try {
      const existing = await getDoc(doc(db, 'prezenta', docId));
      if (existing.exists()) {
        setValidationError('Prezența ta a fost deja înregistrată astăzi!');
        setLoading(false);
        return;
      }
    } catch (err) {
      console.error('Eroare la verificare duplicat:', err);
      setValidationError('Eroare de conexiune. Încearcă din nou.');
      setLoading(false);
      return;
    }

    setStep('success');

    let ip = 'necunoscut';
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const json = await res.json();
      ip = json.ip ?? 'necunoscut';
    } catch {}

    try {
      await setDoc(doc(db, 'prezenta', docId), {
        prenume: prenumeTrim,
        nume: numeTrim,
        clasa: clasaTrim,
        data: today,
        timestamp: Timestamp.now(),
        ip,
        ...(teacher ? { materie: teacher.subject } : {}),
      });
    } catch (err) {
      console.error('Eroare la salvare:', err);
      setStep('error');
    } finally {
      setLoading(false);
    }
  }

  const dateStr = new Date().toLocaleDateString('ro-RO', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  // ── Success ───────────────────────────────────────────────────────────────
  if (step === 'success') {
    return (
      <div className="page-center">
        <div className="card success-card">
          <div className="success-icon">✓</div>
          <h1>Prezența a fost înregistrată!</h1>
          <p className="success-sub">{prenume} {nume} — Clasa {clasa}</p>
          {teacher && (
            <p className="success-sub" style={{ fontSize: '0.95rem' }}>
              Ora de {teacher.subject}
            </p>
          )}
          <p className="success-date">{dateStr}</p>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (step === 'error') {
    return (
      <div className="page-center">
        <div className="card error-card">
          <div className="error-icon">!</div>
          <h1>Eroare de conexiune</h1>
          <p className="success-sub">Nu s-a putut salva prezența.</p>
          <p className="success-date">Verificați conexiunea la internet și reîncercați.</p>
          <div style={{ padding: '0 28px 28px' }}>
            <button className="btn-primary" onClick={() => setStep('form')}>Încearcă din nou</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Locked ────────────────────────────────────────────────────────────────
  if (!lockLoading && locked && teacher) {
    return (
      <div className="page-center">
        <div className="card">
          <div className="card-header" style={{ background: '#6b7280' }}>
            <div className="school-icon">🔒</div>
            <h1>Înregistrare închisă</h1>
            <p className="subtitle">Ora de {teacher.subject}</p>
          </div>
          <div style={{ padding: '32px 28px', textAlign: 'center' }}>
            <p style={{ color: 'var(--gray-600)', fontSize: '0.95rem', lineHeight: 1.6 }}>
              Profesorul a închis înregistrarea prezentei.<br />
              Contactați profesorul pentru mai multe informații.
            </p>
          </div>
          <div style={{ padding: '0 28px 20px', textAlign: 'right' }}>
            <button className="btn-dark-toggle" onClick={() => setDarkMode(d => !d)}>
              {darkMode ? '☀ Mod luminos' : '🌙 Mod întunecat'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <div className="page-center">
      <div className="card">
        <div className="card-header">
          <div className="school-icon">🎓</div>
          <h1>Înregistrare Prezență</h1>
          {teacher && (
            <p className="subtitle" style={{ fontWeight: 700, opacity: 1, fontSize: '1rem' }}>
              Ora de {teacher.subject}
            </p>
          )}
          <p className="subtitle">{dateStr}</p>
        </div>

        <form onSubmit={handleSubmit} className="form">
          <div className="field">
            <label htmlFor="prenume">Prenume</label>
            <input
              id="prenume"
              type="text"
              value={prenume}
              onChange={e => setPrenume(e.target.value)}
              placeholder="ex: Ion"
              autoComplete="given-name"
              disabled={loading}
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="nume">Nume de familie</label>
            <input
              id="nume"
              type="text"
              value={nume}
              onChange={e => setNume(e.target.value)}
              placeholder="ex: Popescu"
              autoComplete="family-name"
              disabled={loading}
            />
          </div>

          {clasaFromUrl ? (
            <div className="field">
              <label>Clasa</label>
              <div className="clasa-locked">
                <span className="badge badge-lg">{clasaFromUrl}</span>
                <span className="clasa-locked-text">pre-completată din QR</span>
              </div>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="clasa">Clasa</label>
              <select id="clasa" value={clasa} onChange={e => setClasa(e.target.value)} disabled={loading}>
                <option value="">— Alege clasa —</option>
                <optgroup label="Clasele V–IX">
                  {ALL_CLASSES_V_IX.map(c => <option key={c} value={c}>{c}</option>)}
                </optgroup>
                <optgroup label="Clasele X–XII">
                  {ALL_CLASSES_X_XII.map(c => <option key={c} value={c}>{c}</option>)}
                </optgroup>
              </select>
            </div>
          )}

          {validationError && <p className="error-msg">{validationError}</p>}

          <button type="submit" className="btn-primary" disabled={loading || lockLoading}>
            {loading
              ? 'Se verifică...'
              : lockLoading
              ? 'Se încarcă...'
              : 'Marchează Prezența'}
          </button>
        </form>

        <div style={{ padding: '0 28px 16px', textAlign: 'right' }}>
          <button className="btn-dark-toggle" onClick={() => setDarkMode(d => !d)}>
            {darkMode ? '☀ Mod luminos' : '🌙 Mod întunecat'}
          </button>
        </div>
      </div>
    </div>
  );
}
