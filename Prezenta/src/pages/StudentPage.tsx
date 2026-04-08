import { useState } from 'react';
import { collection, addDoc, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';

type Step = 'form' | 'success' | 'duplicate';

export default function StudentPage() {
  const [prenume, setPrenume] = useState('');
  const [nume, setNume] = useState('');
  const [clasa, setClasa] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');

  const today = new Date().toISOString().split('T')[0];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const prenumeTrim = prenume.trim();
    const numeTrim = nume.trim();
    const clasaTrim = clasa.trim();

    if (!prenumeTrim || !numeTrim || !clasaTrim) {
      setError('Completează toate câmpurile.');
      return;
    }

    setLoading(true);

    try {
      // Verifică dacă elevul a mai marcat prezența azi
      const q = query(
        collection(db, 'prezenta'),
        where('data', '==', today),
        where('prenume', '==', prenumeTrim),
        where('nume', '==', numeTrim),
        where('clasa', '==', clasaTrim)
      );
      const existing = await getDocs(q);

      if (!existing.empty) {
        setStep('duplicate');
        setLoading(false);
        return;
      }

      await addDoc(collection(db, 'prezenta'), {
        prenume: prenumeTrim,
        nume: numeTrim,
        clasa: clasaTrim,
        data: today,
        timestamp: Timestamp.now(),
      });

      setStep('success');
    } catch (err) {
      setError('Eroare de conexiune. Încearcă din nou.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  if (step === 'success') {
    return (
      <div className="page-center">
        <div className="card success-card">
          <div className="success-icon">✓</div>
          <h1>Prezența a fost înregistrată!</h1>
          <p className="success-sub">
            {prenume} {nume} — Clasa {clasa}
          </p>
          <p className="success-date">{new Date().toLocaleDateString('ro-RO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>
    );
  }

  if (step === 'duplicate') {
    return (
      <div className="page-center">
        <div className="card info-card">
          <div className="info-icon">ℹ</div>
          <h1>Prezența deja înregistrată</h1>
          <p className="success-sub">
            {prenume} {nume} — Clasa {clasa}
          </p>
          <p className="success-date">Ai marcat deja prezența azi.</p>
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
          <p className="subtitle">
            {new Date().toLocaleDateString('ro-RO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
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

          <div className="field">
            <label htmlFor="clasa">Clasa</label>
            <input
              id="clasa"
              type="text"
              value={clasa}
              onChange={e => setClasa(e.target.value)}
              placeholder="ex: XI-A"
              disabled={loading}
            />
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Se înregistrează...' : 'Marchează Prezența'}
          </button>
        </form>
      </div>
    </div>
  );
}
