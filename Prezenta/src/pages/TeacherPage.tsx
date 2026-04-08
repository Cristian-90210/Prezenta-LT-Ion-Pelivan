import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '../firebase';
import type { AttendanceRecord } from '../types';

const TEACHER_PASSWORD = import.meta.env.VITE_TEACHER_PASSWORD || 'profesor2024';

type View = 'login' | 'dashboard';

export default function TeacherPage() {
  const [view, setView] = useState<View>('login');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterClasa, setFilterClasa] = useState('');
  const [qrVisible, setQrVisible] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [fbError, setFbError] = useState('');
  const [fbLoading, setFbLoading] = useState(false);

  const siteUrl = window.location.origin;

  useEffect(() => {
    if (view !== 'dashboard') return;

    setFbError('');
    setFbLoading(true);

    const q = query(
      collection(db, 'prezenta'),
      where('data', '==', selectedDate)
    );

    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        setFbLoading(false);
        const data: AttendanceRecord[] = snapshot.docs.map(d => ({
          id: d.id,
          prenume: d.data().prenume ?? '',
          nume: d.data().nume ?? '',
          clasa: d.data().clasa ?? '',
          timestamp: d.data().timestamp?.toDate() ?? new Date(),
          data: d.data().data ?? selectedDate,
          ip: d.data().ip ?? '—',
        }));
        data.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        setRecords(data);
      },
      err => {
        setFbLoading(false);
        console.error('Firestore error:', err);
        if (err.code === 'permission-denied') {
          setFbError('Acces refuzat de Firestore. Verifică regulile de securitate în Firebase Console → Firestore → Rules și setează-le pe "test mode".');
        } else if (err.message?.includes('projectId')) {
          setFbError('Firebase nu este configurat. Adaugă variabilele de mediu VITE_FIREBASE_* în setările Vercel.');
        } else {
          setFbError(`Eroare Firebase: ${err.message}`);
        }
      }
    );

    return () => unsubscribe();
  }, [view, selectedDate]);

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (password === TEACHER_PASSWORD) {
      setView('dashboard');
      setLoginError('');
    } else {
      setLoginError('Parolă incorectă.');
    }
  }

  async function handleDelete(id: string) {
    await deleteDoc(doc(db, 'prezenta', id));
    setDeleteConfirm(null);
  }

  const ALL_CLASSES = [
    ...['V','VI','VII','VIII','IX'].flatMap(cls => ['A','B','C'].map(lit => `${cls}-${lit}`)),
    ...['X','XI','XII'].flatMap(cls => ['REAL','UMAN'].map(profil => `${cls}-${profil}`)),
  ];
  const filtered = filterClasa ? records.filter(r => r.clasa === filterClasa) : records;

  if (view === 'login') {
    return (
      <div className="page-center">
        <div className="card">
          <div className="card-header">
            <div className="school-icon">👩‍🏫</div>
            <h1>Panou Profesor</h1>
            <p className="subtitle">Introduceți parola pentru acces</p>
          </div>
          <form onSubmit={handleLogin} className="form">
            <div className="field">
              <label htmlFor="password">Parolă</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Parolă profesor"
                autoFocus
              />
            </div>
            {loginError && <p className="error-msg">{loginError}</p>}
            <button type="submit" className="btn-primary">Intră</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="teacher-page">
      <header className="teacher-header">
        <div className="header-content">
          <h1>👩‍🏫 Panou Profesor</h1>
          <div className="header-actions">
            <button className="btn-secondary" onClick={() => setQrVisible(!qrVisible)}>
              {qrVisible ? 'Ascunde QR' : '📱 Afișează QR'}
            </button>
            <button className="btn-outline" onClick={() => setView('login')}>
              Ieșire
            </button>
          </div>
        </div>
      </header>

      <main className="teacher-main">
        {qrVisible && (
          <div className="qr-panel">
            <div className="qr-inner">
              <h2>QR Code — Prezență</h2>
              <p className="qr-sub">Elevii scanează acest cod pentru a marca prezența</p>
              <div className="qr-box">
                <QRCodeSVG value={siteUrl} size={220} level="H" />
              </div>
              <p className="qr-url">{siteUrl}</p>
            </div>
          </div>
        )}

        {fbError && (
          <div className="firebase-error">
            <strong>⚠ Problemă Firebase</strong>
            <p>{fbError}</p>
          </div>
        )}

        <div className="controls">
          <div className="control-row">
            <div className="field">
              <label htmlFor="date">Data</label>
              <input
                id="date"
                type="date"
                value={selectedDate}
                onChange={e => setSelectedDate(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="filter-clasa">Filtrează clasa</label>
              <select
                id="filter-clasa"
                value={filterClasa}
                onChange={e => setFilterClasa(e.target.value)}
              >
                <option value="">Toate clasele</option>
                <optgroup label="Clasele V–IX">
                  {ALL_CLASSES.filter(c => ['V','VI','VII','VIII','IX'].some(cls => c.startsWith(cls + '-'))).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </optgroup>
                <optgroup label="Clasele X–XII">
                  {ALL_CLASSES.filter(c => ['X','XI','XII'].some(cls => c.startsWith(cls + '-'))).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>
        </div>

        <div className="stats-bar">
          <span className="stat">
            <strong>{filtered.length}</strong> elevi prezenți
            {filterClasa ? ` în clasa ${filterClasa}` : ''}
          </span>
          <span className="stat-date">
            {new Date(selectedDate + 'T12:00:00').toLocaleDateString('ro-RO', {
              weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            })}
          </span>
        </div>

        {fbLoading ? (
          <div className="empty-state">Se încarcă datele...</div>
        ) : filtered.length === 0 && !fbError ? (
          <div className="empty-state">
            Niciun elev nu a marcat prezența{filterClasa ? ` pentru clasa ${filterClasa}` : ''} în această zi.
          </div>
        ) : (
          <div className="attendance-table-wrap">
            <table className="attendance-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Prenume</th>
                  <th>Nume</th>
                  <th>Clasa</th>
                  <th>Ora</th>
                  <th>IP</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id}>
                    <td className="td-nr">{i + 1}</td>
                    <td>{r.prenume}</td>
                    <td>{r.nume}</td>
                    <td><span className="badge">{r.clasa}</span></td>
                    <td className="td-time">
                      {r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="td-ip">{r.ip ?? '—'}</td>
                    <td>
                      {deleteConfirm === r.id ? (
                        <span className="delete-confirm">
                          <button className="btn-danger-sm" onClick={() => handleDelete(r.id)}>Da</button>
                          <button className="btn-cancel-sm" onClick={() => setDeleteConfirm(null)}>Nu</button>
                        </span>
                      ) : (
                        <button className="btn-delete" onClick={() => setDeleteConfirm(r.id)} title="Șterge">✕</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
