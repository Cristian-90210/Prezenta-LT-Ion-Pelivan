import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { collection, addDoc, Timestamp, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

type Step = 'form' | 'success' | 'error';

export default function StudentPage() {
  const [searchParams] = useSearchParams();
  const clasaFromUrl = searchParams.get('clasa') ?? '';

  const [prenume, setPrenume] = useState('');
  const [nume, setNume] = useState('');
  const [clasa, setClasa] = useState(clasaFromUrl);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [validationError, setValidationError] = useState('');

  const today = new Date().toISOString().split('T')[0];

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

    setLoading(true);

    // Verificare anti-duplicat
    try {
      const dupQuery = query(
        collection(db, 'prezenta'),
        where('prenume', '==', prenumeTrim),
        where('nume', '==', numeTrim),
        where('clasa', '==', clasaTrim),
        where('data', '==', today)
      );
      const dupSnapshot = await getDocs(dupQuery);
      if (!dupSnapshot.empty) {
        setValidationError('Prezența ta a fost deja înregistrată astăzi!');
        setLoading(false);
        return;
      }
    } catch {
      // Dacă verificarea eșuează, continuăm oricum
    }

    // Afișăm succes după ce verificarea anti-duplicat a trecut
    setStep('success');

    // Obținem IP-ul și salvăm în fundal
    let ip = 'necunoscut';
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const json = await res.json();
      ip = json.ip ?? 'necunoscut';
    } catch {
      // IP rămâne 'necunoscut'
    }

    try {
      await addDoc(collection(db, 'prezenta'), {
        prenume: prenumeTrim,
        nume: numeTrim,
        clasa: clasaTrim,
        data: today,
        timestamp: Timestamp.now(),
        ip,
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

  if (step === 'success') {
    return (
      <div className="page-center">
        <div className="card success-card">
          <div className="success-icon">✓</div>
          <h1>Prezența a fost înregistrată!</h1>
          <p className="success-sub">{prenume} {nume} — Clasa {clasa}</p>
          <p className="success-date">{dateStr}</p>
        </div>
      </div>
    );
  }

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

  return (
    <div className="page-center">
      <div className="card">
        <div className="card-header">
          <div className="school-icon">🎓</div>
          <h1>Înregistrare Prezență</h1>
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
              <select
                id="clasa"
                value={clasa}
                onChange={e => setClasa(e.target.value)}
                disabled={loading}
              >
                <option value="">— Alege clasa —</option>
                <optgroup label="Clasele V–IX">
                  {['V', 'VI', 'VII', 'VIII', 'IX'].flatMap(cls =>
                    ['A', 'B', 'C'].map(lit => (
                      <option key={`${cls}-${lit}`} value={`${cls}-${lit}`}>{cls}-{lit}</option>
                    ))
                  )}
                </optgroup>
                <optgroup label="Clasele X–XII">
                  {['X', 'XI', 'XII'].flatMap(cls =>
                    ['REAL', 'UMAN'].map(profil => (
                      <option key={`${cls}-${profil}`} value={`${cls}-${profil}`}>{cls}-{profil}</option>
                    ))
                  )}
                </optgroup>
              </select>
            </div>
          )}

          {validationError && <p className="error-msg">{validationError}</p>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Se verifică...' : 'Marchează Prezența'}
          </button>
        </form>
      </div>
    </div>
  );
}
