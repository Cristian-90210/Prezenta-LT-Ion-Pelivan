import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, orderBy, deleteDoc, doc } from 'firebase/firestore';
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

  const siteUrl = window.location.origin;

  useEffect(() => {
    if (view !== 'dashboard') return;

    const q = query(
      collection(db, 'prezenta'),
      where('data', '==', selectedDate),
      orderBy('timestamp', 'asc')
    );

    const unsubscribe = onSnapshot(q, snapshot => {
      const data: AttendanceRecord[] = snapshot.docs.map(d => ({
        id: d.id,
        prenume: d.data().prenume,
        nume: d.data().nume,
        clasa: d.data().clasa,
        timestamp: d.data().timestamp?.toDate() ?? new Date(),
        data: d.data().data,
      }));
      setRecords(data);
    });

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

  const classes = [...new Set(records.map(r => r.clasa))].sort();
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
                {classes.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
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
            {new Date(selectedDate).toLocaleDateString('ro-RO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">
            <p>Niciun elev nu a marcat prezența {filterClasa ? `pentru clasa ${filterClasa}` : ''} în această zi.</p>
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
                    <td>
                      {deleteConfirm === r.id ? (
                        <span className="delete-confirm">
                          <button className="btn-danger-sm" onClick={() => handleDelete(r.id)}>Da, șterge</button>
                          <button className="btn-cancel-sm" onClick={() => setDeleteConfirm(null)}>Anulează</button>
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
