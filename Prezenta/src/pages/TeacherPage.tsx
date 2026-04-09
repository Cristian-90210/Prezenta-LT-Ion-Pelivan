import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, deleteDoc, doc, getDocs } from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '../firebase';
import type { AttendanceRecord } from '../types';

const TEACHER_PASSWORD = import.meta.env.VITE_TEACHER_PASSWORD || 'profesor2024';

type View = 'login' | 'dashboard';
type DashTab = 'lista' | 'statistici' | 'istoric';

const ALL_CLASSES = [
  ...['V', 'VI', 'VII', 'VIII', 'IX'].flatMap(cls => ['A', 'B', 'C'].map(lit => `${cls}-${lit}`)),
  ...['X', 'XI', 'XII'].flatMap(cls => ['REAL', 'UMAN'].map(profil => `${cls}-${profil}`)),
];

export default function TeacherPage() {
  const [view, setView] = useState<View>('login');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterClasa, setFilterClasa] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [qrVisible, setQrVisible] = useState(false);
  const [qrMode, setQrMode] = useState<'general' | 'perClasa'>('general');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [fbError, setFbError] = useState('');
  const [fbLoading, setFbLoading] = useState(false);
  const [dashTab, setDashTab] = useState<DashTab>('lista');

  // Istoric states
  const [istoricPrenume, setIstoricPrenume] = useState('');
  const [istoricNume, setIstoricNume] = useState('');
  const [istoricRecords, setIstoricRecords] = useState<AttendanceRecord[]>([]);
  const [istoricLoading, setIstoricLoading] = useState(false);
  const [istoricError, setIstoricError] = useState('');
  const [istoricSearched, setIstoricSearched] = useState(false);

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

  async function handleIstoricSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!istoricPrenume.trim() || !istoricNume.trim()) return;
    setIstoricLoading(true);
    setIstoricError('');
    setIstoricSearched(true);
    try {
      const q = query(
        collection(db, 'prezenta'),
        where('prenume', '==', istoricPrenume.trim()),
        where('nume', '==', istoricNume.trim())
      );
      const snapshot = await getDocs(q);
      const data: AttendanceRecord[] = snapshot.docs.map(d => ({
        id: d.id,
        prenume: d.data().prenume ?? '',
        nume: d.data().nume ?? '',
        clasa: d.data().clasa ?? '',
        timestamp: d.data().timestamp?.toDate() ?? new Date(),
        data: d.data().data ?? '',
        ip: d.data().ip ?? '—',
      }));
      data.sort((a, b) => b.data.localeCompare(a.data));
      setIstoricRecords(data);
    } catch (err) {
      console.error(err);
      setIstoricError('Eroare la căutare în baza de date.');
    } finally {
      setIstoricLoading(false);
    }
  }

  function exportCSV() {
    const rows = [
      ['Nr', 'Prenume', 'Nume', 'Clasa', 'Ora', 'IP'],
      ...filtered.map((r, i) => [
        String(i + 1),
        r.prenume,
        r.nume,
        r.clasa,
        r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
        r.ip ?? '—',
      ]),
    ];
    const csv = rows.map(row => row.map(cell => `"${cell}"`).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prezenta-${selectedDate}${filterClasa ? '-' + filterClasa : ''}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const filtered = records.filter(r => {
    const matchesClasa = !filterClasa || r.clasa === filterClasa;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      r.prenume.toLowerCase().includes(q) ||
      r.nume.toLowerCase().includes(q) ||
      `${r.prenume} ${r.nume}`.toLowerCase().includes(q);
    return matchesClasa && matchesSearch;
  });

  const statsByClass = ALL_CLASSES
    .map(cls => ({ clasa: cls, count: records.filter(r => r.clasa === cls).length }))
    .filter(s => s.count > 0);
  const maxCount = statsByClass.length > 0 ? Math.max(...statsByClass.map(s => s.count)) : 1;

  // ── Login ──────────────────────────────────────────────────────────────────
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

  // ── Dashboard ──────────────────────────────────────────────────────────────
  return (
    <div className="teacher-page">
      <header className="teacher-header">
        <div className="header-content">
          <h1>👩‍🏫 Panou Profesor</h1>
          <div className="header-actions">
            <button className="btn-secondary" onClick={() => setQrVisible(!qrVisible)}>
              {qrVisible ? 'Ascunde QR' : '📱 QR Coduri'}
            </button>
            <button className="btn-outline" onClick={() => setView('login')}>
              Ieșire
            </button>
          </div>
        </div>
        <div className="dash-tabs">
          <button
            className={`dash-tab${dashTab === 'lista' ? ' active' : ''}`}
            onClick={() => setDashTab('lista')}
          >
            Lista
          </button>
          <button
            className={`dash-tab${dashTab === 'statistici' ? ' active' : ''}`}
            onClick={() => setDashTab('statistici')}
          >
            Statistici
          </button>
          <button
            className={`dash-tab${dashTab === 'istoric' ? ' active' : ''}`}
            onClick={() => setDashTab('istoric')}
          >
            Istoric elev
          </button>
        </div>
      </header>

      <main className="teacher-main">

        {/* ── QR Panel ── */}
        {qrVisible && (
          <div className="qr-panel">
            <div className="qr-inner">
              <div className="qr-mode-toggle">
                <button
                  className={`qr-mode-btn${qrMode === 'general' ? ' active' : ''}`}
                  onClick={() => setQrMode('general')}
                >
                  QR General
                </button>
                <button
                  className={`qr-mode-btn${qrMode === 'perClasa' ? ' active' : ''}`}
                  onClick={() => setQrMode('perClasa')}
                >
                  QR per Clasă
                </button>
              </div>

              {qrMode === 'general' ? (
                <>
                  <h2>QR Code — Prezență</h2>
                  <p className="qr-sub">Elevii scanează acest cod pentru a marca prezența</p>
                  <div className="qr-box">
                    <QRCodeSVG value={siteUrl} size={220} level="H" />
                  </div>
                  <p className="qr-url">{siteUrl}</p>
                </>
              ) : (
                <>
                  <h2>QR Coduri per Clasă</h2>
                  <p className="qr-sub">Fiecare cod pre-completează clasa elevului automat</p>
                  <div className="qr-grid">
                    {ALL_CLASSES.map(cls => (
                      <div className="qr-class-item" key={cls}>
                        <QRCodeSVG
                          value={`${siteUrl}/?clasa=${encodeURIComponent(cls)}`}
                          size={110}
                          level="M"
                        />
                        <span className="qr-class-label">{cls}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Firebase error ── */}
        {fbError && (
          <div className="firebase-error">
            <strong>⚠ Problemă Firebase</strong>
            <p>{fbError}</p>
          </div>
        )}

        {/* ══════════════ TAB: LISTA ══════════════ */}
        {dashTab === 'lista' && (
          <>
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
                      {ALL_CLASSES.filter(c =>
                        ['V', 'VI', 'VII', 'VIII', 'IX'].some(cls => c.startsWith(cls + '-'))
                      ).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Clasele X–XII">
                      {ALL_CLASSES.filter(c =>
                        ['X', 'XI', 'XII'].some(cls => c.startsWith(cls + '-'))
                      ).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="search-elev">Caută elev</label>
                  <input
                    id="search-elev"
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Prenume sau Nume..."
                  />
                </div>
              </div>
            </div>

            <div className="stats-bar">
              <span className="stat">
                <strong>{filtered.length}</strong> elevi prezenți
                {filterClasa ? ` în clasa ${filterClasa}` : ''}
              </span>
              <div className="stats-bar-actions">
                <span className="stat-date">
                  {new Date(selectedDate + 'T12:00:00').toLocaleDateString('ro-RO', {
                    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </span>
                {filtered.length > 0 && (
                  <>
                    <button className="btn-action" onClick={exportCSV} title="Exportă CSV">
                      ⬇ CSV
                    </button>
                    <button className="btn-action no-print" onClick={() => window.print()} title="Printează lista">
                      🖨 Print
                    </button>
                  </>
                )}
              </div>
            </div>

            {fbLoading ? (
              <div className="empty-state">Se încarcă datele...</div>
            ) : filtered.length === 0 && !fbError ? (
              <div className="empty-state">
                Niciun elev nu a marcat prezența
                {filterClasa ? ` pentru clasa ${filterClasa}` : ''} în această zi.
              </div>
            ) : (
              <div className="attendance-table-wrap" id="print-area">
                <div className="print-header">
                  <strong>
                    Prezența —{' '}
                    {new Date(selectedDate + 'T12:00:00').toLocaleDateString('ro-RO', {
                      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
                    })}
                  </strong>
                  {filterClasa && <span> — Clasa {filterClasa}</span>}
                </div>
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Prenume</th>
                      <th>Nume</th>
                      <th>Clasa</th>
                      <th>Ora</th>
                      <th className="no-print">IP</th>
                      <th className="no-print"></th>
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
                        <td className="td-ip no-print">{r.ip ?? '—'}</td>
                        <td className="no-print">
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
          </>
        )}

        {/* ══════════════ TAB: STATISTICI ══════════════ */}
        {dashTab === 'statistici' && (
          <>
            <div className="controls">
              <div className="control-row">
                <div className="field">
                  <label htmlFor="date-stats">Data</label>
                  <input
                    id="date-stats"
                    type="date"
                    value={selectedDate}
                    onChange={e => setSelectedDate(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="stats-summary">
              <div className="stat-card">
                <div className="stat-card-value">{records.length}</div>
                <div className="stat-card-label">Total elevi prezenți</div>
              </div>
              <div className="stat-card">
                <div className="stat-card-value">{statsByClass.length}</div>
                <div className="stat-card-label">Clase reprezentate</div>
              </div>
              {statsByClass.length > 0 && (
                <div className="stat-card">
                  <div className="stat-card-value">
                    {statsByClass.reduce((a, b) => a.count >= b.count ? a : b).clasa}
                  </div>
                  <div className="stat-card-label">Clasa cu cei mai mulți</div>
                </div>
              )}
            </div>

            {fbLoading ? (
              <div className="empty-state">Se încarcă datele...</div>
            ) : statsByClass.length === 0 ? (
              <div className="empty-state">Nicio prezență înregistrată în această zi.</div>
            ) : (
              <div className="bar-chart-panel">
                <h3>Prezenți per clasă</h3>
                <div className="bar-chart">
                  {statsByClass.map(s => (
                    <div className="bar-item" key={s.clasa}>
                      <div className="bar-label">{s.clasa}</div>
                      <div className="bar-track">
                        <div
                          className="bar-fill"
                          style={{ width: `${(s.count / maxCount) * 100}%` }}
                        />
                        <span className="bar-value">{s.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════ TAB: ISTORIC ══════════════ */}
        {dashTab === 'istoric' && (
          <>
            <div className="controls">
              <form onSubmit={handleIstoricSearch}>
                <div className="control-row">
                  <div className="field">
                    <label htmlFor="ist-prenume">Prenume</label>
                    <input
                      id="ist-prenume"
                      type="text"
                      value={istoricPrenume}
                      onChange={e => setIstoricPrenume(e.target.value)}
                      placeholder="ex: Ion"
                      autoFocus
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ist-nume">Nume de familie</label>
                    <input
                      id="ist-nume"
                      type="text"
                      value={istoricNume}
                      onChange={e => setIstoricNume(e.target.value)}
                      placeholder="ex: Popescu"
                    />
                  </div>
                  <div className="field field-btn">
                    <label>&nbsp;</label>
                    <button type="submit" className="btn-search" disabled={istoricLoading}>
                      {istoricLoading ? 'Caută...' : 'Caută'}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {istoricError && <p className="error-msg">{istoricError}</p>}

            {istoricSearched && !istoricLoading && (
              istoricRecords.length === 0 ? (
                <div className="empty-state">
                  Niciun rezultat pentru „{istoricPrenume} {istoricNume}".
                </div>
              ) : (
                <div className="attendance-table-wrap">
                  <div className="istoric-result-header">
                    <strong>{istoricPrenume} {istoricNume}</strong>
                    <span className="istoric-count">{istoricRecords.length} zile prezent</span>
                  </div>
                  <table className="attendance-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Data</th>
                        <th>Clasa</th>
                        <th>Ora</th>
                      </tr>
                    </thead>
                    <tbody>
                      {istoricRecords.map((r, i) => (
                        <tr key={r.id}>
                          <td className="td-nr">{i + 1}</td>
                          <td>
                            {new Date(r.data + 'T12:00:00').toLocaleDateString('ro-RO', {
                              weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
                            })}
                          </td>
                          <td><span className="badge">{r.clasa}</span></td>
                          <td className="td-time">
                            {r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}
