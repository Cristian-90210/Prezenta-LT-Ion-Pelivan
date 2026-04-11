import { useState, useEffect } from 'react';
import {
  collection, query, where, onSnapshot, deleteDoc, doc,
  getDocs, updateDoc, setDoc,
} from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import { db } from '../firebase';
import type { AttendanceRecord } from '../types';
import { useConfig } from '../hooks/useConfig';
import type { Teacher } from '../teachers';

type View = 'login' | 'dashboard';
type DashTab = 'lista' | 'statistici' | 'raport' | 'istoric';

export default function TeacherPage() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const [view, setView] = useState<View>('login');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [currentTeacher, setCurrentTeacher] = useState<Teacher | null>(null);

  // ── Dark mode ─────────────────────────────────────────────────────────────
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');

  // ── Dashboard data ────────────────────────────────────────────────────────
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [filterClasa, setFilterClasa] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [fbError, setFbError] = useState('');
  const [fbLoading, setFbLoading] = useState(false);
  const [dashTab, setDashTab] = useState<DashTab>('lista');

  // ── QR ────────────────────────────────────────────────────────────────────
  const [qrVisible, setQrVisible] = useState(false);
  const [qrMode, setQrMode] = useState<'general' | 'perClasa'>('general');
  const [qrZoom, setQrZoom] = useState<string | null>(null); // clasa selectată pentru zoom

  // ── Lock ──────────────────────────────────────────────────────────────────
  const [locked, setLocked] = useState(false);
  const [lockLoading, setLockLoading] = useState(false);

  // ── Mobile sidebar ──────────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Delete ────────────────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // ── Edit ──────────────────────────────────────────────────────────────────
  const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
  const [editPrenume, setEditPrenume] = useState('');
  const [editNume, setEditNume] = useState('');
  const [editClasa, setEditClasa] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // ── Istoric ───────────────────────────────────────────────────────────────
  const [istoricPrenume, setIstoricPrenume] = useState('');
  const [istoricNume, setIstoricNume] = useState('');
  const [istoricRecords, setIstoricRecords] = useState<AttendanceRecord[]>([]);
  const [istoricLoading, setIstoricLoading] = useState(false);
  const [istoricError, setIstoricError] = useState('');
  const [istoricSearched, setIstoricSearched] = useState(false);

  // ── Raport interval ───────────────────────────────────────────────────────
  const [rangeFrom, setRangeFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [rangeTo, setRangeTo] = useState(new Date().toISOString().split('T')[0]);
  const [rangeRecords, setRangeRecords] = useState<AttendanceRecord[]>([]);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeSearched, setRangeSearched] = useState(false);

  const { teachers, classes: ALL_CLASSES } = useConfig();
  const siteUrl = window.location.origin;

  // ── Dark mode effect ──────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // ── Load records for selected date ────────────────────────────────────────
  useEffect(() => {
    if (view !== 'dashboard' || !currentTeacher) return;

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
          materie: d.data().materie ?? '',
        }));
        data.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        setRecords(data.filter(r => r.materie === currentTeacher.subject));
      },
      err => {
        setFbLoading(false);
        if (err.code === 'permission-denied') {
          setFbError('Acces refuzat de Firestore. Verifică regulile de securitate în Firebase Console.');
        } else {
          setFbError(`Eroare Firebase: ${err.message}`);
        }
      }
    );

    return () => unsubscribe();
  }, [view, selectedDate, currentTeacher]);

  // ── Subscribe to lock state ───────────────────────────────────────────────
  useEffect(() => {
    if (view !== 'dashboard' || !currentTeacher) return;
    const lockRef = doc(db, 'settings', 'lock');
    const unsubscribe = onSnapshot(lockRef, snap => {
      setLocked(snap.exists() ? snap.data()[currentTeacher.id] === true : false);
    });
    return () => unsubscribe();
  }, [view, currentTeacher]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    const teacher = teachers.find(t => t.password === password);
    if (teacher) {
      setCurrentTeacher(teacher);
      setView('dashboard');
      setLoginError('');
    } else {
      setLoginError('Parolă incorectă.');
    }
  }

  function handleLogout() {
    setView('login');
    setCurrentTeacher(null);
    setPassword('');
    setRecords([]);
  }

  async function handleToggleLock() {
    if (!currentTeacher) return;
    setLockLoading(true);
    try {
      await setDoc(doc(db, 'settings', 'lock'), { [currentTeacher.id]: !locked }, { merge: true });
    } catch (err) {
      console.error(err);
    } finally {
      setLockLoading(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteDoc(doc(db, 'prezenta', id));
    setDeleteConfirm(null);
  }

  function startEdit(record: AttendanceRecord) {
    setEditingRecord(record);
    setEditPrenume(record.prenume);
    setEditNume(record.nume);
    setEditClasa(record.clasa);
  }

  async function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingRecord) return;
    setEditSaving(true);
    try {
      await updateDoc(doc(db, 'prezenta', editingRecord.id), {
        prenume: editPrenume.trim(),
        nume: editNume.trim(),
        clasa: editClasa,
      });
      setEditingRecord(null);
    } catch (err) {
      console.error(err);
    } finally {
      setEditSaving(false);
    }
  }

  async function handleIstoricSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!istoricPrenume.trim() || !istoricNume.trim() || !currentTeacher) return;
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
        materie: d.data().materie ?? '',
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

  async function handleRangeSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!currentTeacher) return;
    setRangeLoading(true);
    setRangeSearched(true);
    try {
      const q = query(
        collection(db, 'prezenta'),
        where('data', '>=', rangeFrom),
        where('data', '<=', rangeTo)
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
        materie: d.data().materie ?? '',
      }));
      setRangeRecords(data.filter(r => r.materie === currentTeacher.subject));
    } catch (err) {
      console.error(err);
    } finally {
      setRangeLoading(false);
    }
  }

  // ── CSV helpers ───────────────────────────────────────────────────────────
  // null = rând gol (separator vizual); string[] = rând cu valori citate
  function downloadCSV(rows: (string[] | null)[], filename: string) {
    const csv = rows
      .map(row => row === null ? '' : row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  function exportCSV() {
    const dateLong = new Date(selectedDate + 'T12:00:00').toLocaleDateString('ro-RO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    downloadCSV(
      [
        [`=== PREZENȚĂ — ${currentTeacher?.subject ?? ''} ===`],
        ['Data:', dateLong],
        ...(filterClasa ? [['Clasa:', filterClasa]] : []) as (string[])[],
        ['Total prezenți:', String(filtered.length)],
        ['---'],
        null,
        ['#', 'Prenume', 'Nume', 'Clasa', 'Ora', 'IP'],
        ...filtered.map((r, i) => [
          String(i + 1), r.prenume, r.nume, r.clasa,
          r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
          r.ip ?? '—',
        ]),
      ],
      `prezenta-${selectedDate}${filterClasa ? '-' + filterClasa : ''}.csv`
    );
  }

  function exportIstoricCSV() {
    downloadCSV(
      [
        [`=== RAPORT ELEV — Toate materiile ===`],
        ['Elev:', `${istoricPrenume} ${istoricNume}`],
        ['Total prezențe:', String(istoricRecords.length)],
        ['---'],
        null,
        ['#', 'Data', 'Clasa', 'Materie', 'Ora'],
        ...istoricRecords.map((r, i) => [
          String(i + 1),
          new Date(r.data + 'T12:00:00').toLocaleDateString('ro-RO', { year: 'numeric', month: '2-digit', day: '2-digit' }),
          r.clasa,
          r.materie ?? '—',
          r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
        ]),
      ],
      `raport-elev-${istoricPrenume}-${istoricNume}.csv`
    );
  }

  function exportRangeCSV() {
    // Grupăm înregistrările detaliate pe zile
    const byDate = rangeRecords.reduce<Record<string, typeof rangeRecords>>((acc, r) => {
      if (!acc[r.data]) acc[r.data] = [];
      acc[r.data].push(r);
      return acc;
    }, {});
    const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

    const rows: (string[] | null)[] = [
      [`=== RAPORT INTERVAL — ${currentTeacher?.subject ?? ''} ===`],
      ['Interval:', `${rangeFrom} → ${rangeTo}`],
      ['Total înregistrări:', String(rangeRecords.length)],
      ['Elevi unici:', String(rangeByStudent.length)],
      ['---'],
      null,
      // ── Secțiunea 1: frecvență per elev ──
      ['=== FRECVENȚĂ ELEVI ==='],
      ['#', 'Prenume', 'Nume', 'Clasa', 'Zile prezent'],
      ...rangeByStudent.map((s, i) => [
        String(i + 1), s.prenume, s.nume, s.clasa, String(s.count),
      ]),
      null,
      // ── Secțiunea 2: detaliu pe zile ──
      ['=== DETALIU PE ZILE ==='],
      ...sortedDates.flatMap(date => {
        const dateLong = new Date(date + 'T12:00:00').toLocaleDateString('ro-RO', {
          weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        });
        return [
          null,
          [`--- ${dateLong} (${byDate[date].length} prezenți) ---`],
          ['#', 'Prenume', 'Nume', 'Clasa', 'Ora'],
          ...byDate[date].map((r, i) => [
            String(i + 1), r.prenume, r.nume, r.clasa,
            r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
          ]),
        ] as (string[] | null)[];
      }),
    ];

    downloadCSV(rows, `raport-${rangeFrom}-${rangeTo}.csv`);
  }

  // ── Derived data ──────────────────────────────────────────────────────────
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

  const rangeByStudent = Object.values(
    rangeRecords.reduce<Record<string, { prenume: string; nume: string; clasa: string; count: number }>>((acc, r) => {
      const key = `${r.prenume}|${r.nume}`;
      if (!acc[key]) acc[key] = { prenume: r.prenume, nume: r.nume, clasa: r.clasa, count: 0 };
      acc[key].count++;
      return acc;
    }, {})
  ).sort((a, b) => b.count - a.count);

  const qrBaseUrl = `${siteUrl}/?materie=${encodeURIComponent(currentTeacher?.id ?? '')}`;

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
                placeholder="Parola dumneavoastră"
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
  const TAB_ITEMS: { id: DashTab; icon: string; label: string }[] = [
    { id: 'lista',      icon: '📋', label: 'Listă' },
    { id: 'statistici', icon: '📊', label: 'Statistici' },
    { id: 'raport',     icon: '📅', label: 'Raport interval' },
    { id: 'istoric',    icon: '👤', label: 'Raport elev' },
  ];

  return (
    <div className="teacher-page">

      {/* ══════════ MOBILE SIDEBAR ══════════ */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}>
          <div className="sidebar" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="sidebar-header">
              <span className="sidebar-logo">🎓 LT Ion Pelivan</span>
              <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>✕</button>
            </div>

            {/* Profil profesor */}
            <div className="sidebar-profile">
              <div className="sidebar-avatar">
                {currentTeacher?.name?.charAt(0).toUpperCase() ?? '👩'}
              </div>
              <div className="sidebar-profile-info">
                <span className="sidebar-profile-name">{currentTeacher?.name}</span>
                <span className="sidebar-profile-sub">{currentTeacher?.subject}</span>
                <span className="sidebar-badge">Profesor</span>
              </div>
            </div>

            {/* Navigare tab-uri */}
            <nav className="sidebar-nav">
              {TAB_ITEMS.map(item => (
                <button
                  key={item.id}
                  className={`sidebar-nav-item${dashTab === item.id ? ' active' : ''}`}
                  onClick={() => { setDashTab(item.id); setSidebarOpen(false); }}
                >
                  <span className="sidebar-nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>

            {/* Footer */}
            <div className="sidebar-footer">
              {/* Blocare */}
              <div className="sidebar-lock-row">
                <span className="sidebar-lock-label">
                  {locked ? '🔒 Înregistrare blocată' : '🔓 Înregistrare activă'}
                </span>
                <button
                  className={`sidebar-lock-btn${locked ? ' locked' : ''}`}
                  onClick={handleToggleLock}
                  disabled={lockLoading}
                >
                  {locked ? 'Deschide' : 'Blochează'}
                </button>
              </div>

              {/* QR Toggle */}
              <div className="sidebar-toggle-row">
                <span className="sidebar-toggle-label">📱 Afișează QR</span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={qrVisible}
                    onChange={() => { setQrVisible(v => !v); setSidebarOpen(false); }}
                  />
                  <span className="toggle-slider" />
                </label>
              </div>

              {/* Dark mode */}
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

              {/* Deconectare */}
              <button className="sidebar-logout" onClick={() => { handleLogout(); setSidebarOpen(false); }}>
                ↩ Deconectare
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ══════════ END SIDEBAR ══════════ */}

      <header className="teacher-header">
        <div className="header-content">
          <div className="header-title">
            <h1>👩‍🏫 {currentTeacher?.subject}</h1>
            <span className="header-teacher-name">{currentTeacher?.name}</span>
          </div>

          {/* Hamburger — doar mobil */}
          <button
            className="btn-hamburger"
            onClick={() => setSidebarOpen(true)}
            aria-label="Deschide meniu"
          >
            ☰
          </button>

          {/* Acțiuni — doar desktop */}
          <div className="header-actions header-actions-desktop">
            <button
              className={`btn-lock${locked ? ' locked' : ''}`}
              onClick={handleToggleLock}
              disabled={lockLoading}
              title={locked ? 'Deschide înregistrarea' : 'Blochează înregistrarea'}
            >
              {locked ? '🔒 Blocat' : '🔓 Activ'}
            </button>
            <button className="btn-secondary" onClick={() => setQrVisible(v => !v)}>
              {qrVisible ? 'Ascunde QR' : '📱 QR'}
            </button>
            <button
              className="btn-outline"
              onClick={() => setDarkMode(d => !d)}
              title="Mod întunecat"
            >
              {darkMode ? '☀' : '🌙'}
            </button>
            <button className="btn-outline" onClick={handleLogout}>Ieșire</button>
          </div>
        </div>
        <div className="dash-tabs">
          {TAB_ITEMS.map(item => (
            <button
              key={item.id}
              className={`dash-tab${dashTab === item.id ? ' active' : ''}`}
              onClick={() => setDashTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <main className="teacher-main">

        {/* ── Edit Modal ── */}
        {editingRecord && (
          <div className="modal-overlay" onClick={() => setEditingRecord(null)}>
            <div className="modal-box" onClick={e => e.stopPropagation()}>
              <h2 className="modal-title">Editează înregistrarea</h2>
              <form onSubmit={handleSaveEdit} className="form">
                <div className="field">
                  <label>Prenume</label>
                  <input value={editPrenume} onChange={e => setEditPrenume(e.target.value)} disabled={editSaving} />
                </div>
                <div className="field">
                  <label>Nume de familie</label>
                  <input value={editNume} onChange={e => setEditNume(e.target.value)} disabled={editSaving} />
                </div>
                <div className="field">
                  <label>Clasa</label>
                  <select value={editClasa} onChange={e => setEditClasa(e.target.value)} disabled={editSaving}>
                    <option value="">— Alege clasa —</option>
                    <optgroup label="Clasele V–IX">
                      {ALL_CLASSES.filter(c => ['V','VI','VII','VIII','IX'].some(cls => c.startsWith(cls+'-'))).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Clasele X–XII">
                      {ALL_CLASSES.filter(c => ['X','XI','XII'].some(cls => c.startsWith(cls+'-'))).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn-cancel-sm"
                    style={{ padding: '10px 20px', fontSize: '0.9rem' }}
                    onClick={() => setEditingRecord(null)}
                  >
                    Anulează
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    style={{ width: 'auto', padding: '10px 24px' }}
                    disabled={editSaving}
                  >
                    {editSaving ? 'Se salvează...' : 'Salvează'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}


        {/* ── Lock Banner ── */}
        {locked && (
          <div className="lock-banner">
            🔒 Înregistrarea prezentei este blocată. Elevii nu pot marca prezența momentan.
          </div>
        )}

        {/* ── QR Modal ── */}
        {qrVisible && (
          <div className="modal-overlay" onClick={() => { setQrVisible(false); setQrZoom(null); }}>
            <div className="qr-modal-box" onClick={e => e.stopPropagation()}>

              {/* Header sticky */}
              <div className="qr-zoom-header">
                {qrZoom ? (
                  <button
                    className="qr-back-btn"
                    onClick={() => setQrZoom(null)}
                  >
                    ← Înapoi la grilă
                  </button>
                ) : (
                  <div className="qr-mode-toggle" style={{ margin: 0 }}>
                    <button
                      className={`qr-mode-btn${qrMode === 'general' ? ' active' : ''}`}
                      onClick={() => { setQrMode('general'); setQrZoom(null); }}
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
                )}
                <button className="qr-zoom-close" onClick={() => { setQrVisible(false); setQrZoom(null); }}>✕</button>
              </div>

              <div className="qr-inner">
                {qrMode === 'general' ? (
                  <>
                    <h2>QR — {currentTeacher?.subject}</h2>
                    <p className="qr-sub">
                      Elevii scanează pentru a marca prezența la <strong>{currentTeacher?.subject}</strong>
                    </p>
                    <div className="qr-box">
                      <QRCodeSVG value={qrBaseUrl} size={220} level="H" />
                    </div>
                    <p className="qr-url">{qrBaseUrl}</p>
                  </>
                ) : qrZoom ? (
                  /* ── Zoom view (inline, same modal) ── */
                  <div className="qr-zoom-inline">
                    <div className="qr-zoom-inline-title">
                      Clasa <strong>{qrZoom}</strong> — {currentTeacher?.subject}
                    </div>
                    <div className="qr-box qr-box--zoomed">
                      <QRCodeSVG
                        value={`${qrBaseUrl}&clasa=${encodeURIComponent(qrZoom)}`}
                        size={300}
                        level="H"
                      />
                    </div>
                    <p className="qr-url">{`${qrBaseUrl}&clasa=${encodeURIComponent(qrZoom)}`}</p>
                    <div className="qr-zoom-nav">
                      <button
                        className="btn-action"
                        onClick={() => {
                          const idx = ALL_CLASSES.indexOf(qrZoom);
                          if (idx > 0) setQrZoom(ALL_CLASSES[idx - 1]);
                        }}
                        disabled={ALL_CLASSES.indexOf(qrZoom) === 0}
                      >
                        ← Anterior
                      </button>
                      <span className="qr-zoom-counter">
                        {ALL_CLASSES.indexOf(qrZoom) + 1} / {ALL_CLASSES.length}
                      </span>
                      <button
                        className="btn-action"
                        onClick={() => {
                          const idx = ALL_CLASSES.indexOf(qrZoom);
                          if (idx < ALL_CLASSES.length - 1) setQrZoom(ALL_CLASSES[idx + 1]);
                        }}
                        disabled={ALL_CLASSES.indexOf(qrZoom) === ALL_CLASSES.length - 1}
                      >
                        Următor →
                      </button>
                    </div>
                  </div>
                ) : (
                  /* ── Grid view ── */
                  <>
                    <h2>QR per Clasă — {currentTeacher?.subject}</h2>
                    <p className="qr-sub">Apasă pe un cod QR pentru a-l mări</p>
                    <div className="qr-grid">
                      {ALL_CLASSES.map(cls => (
                        <div
                          className="qr-class-item qr-class-item--clickable"
                          key={cls}
                          onClick={() => setQrZoom(cls)}
                          title={`Mărește QR pentru ${cls}`}
                        >
                          <QRCodeSVG
                            value={`${qrBaseUrl}&clasa=${encodeURIComponent(cls)}`}
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
                  <input id="date" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="filter-clasa">Filtrează clasa</label>
                  <select id="filter-clasa" value={filterClasa} onChange={e => setFilterClasa(e.target.value)}>
                    <option value="">Toate clasele</option>
                    <optgroup label="Clasele V–IX">
                      {ALL_CLASSES.filter(c => ['V','VI','VII','VIII','IX'].some(cls => c.startsWith(cls+'-'))).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Clasele X–XII">
                      {ALL_CLASSES.filter(c => ['X','XI','XII'].some(cls => c.startsWith(cls+'-'))).map(c => (
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
                    <button className="btn-action" onClick={exportCSV}>⬇ CSV</button>
                    <button className="btn-action no-print" onClick={() => window.print()}>🖨 Print</button>
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
                    Prezența — {currentTeacher?.subject} —{' '}
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
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button className="btn-edit" onClick={() => startEdit(r)} title="Editează">✎</button>
                            {deleteConfirm === r.id ? (
                              <span className="delete-confirm">
                                <button className="btn-danger-sm" onClick={() => handleDelete(r.id)}>Da</button>
                                <button className="btn-cancel-sm" onClick={() => setDeleteConfirm(null)}>Nu</button>
                              </span>
                            ) : (
                              <button className="btn-delete" onClick={() => setDeleteConfirm(r.id)} title="Șterge">✕</button>
                            )}
                          </div>
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
                  <input id="date-stats" type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} />
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
                <h3>Prezenți per clasă — {currentTeacher?.subject}</h3>
                <div className="bar-chart">
                  {statsByClass.map(s => (
                    <div className="bar-item" key={s.clasa}>
                      <div className="bar-label">{s.clasa}</div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(s.count / maxCount) * 100}%` }} />
                        <span className="bar-value">{s.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ══════════════ TAB: RAPORT INTERVAL ══════════════ */}
        {dashTab === 'raport' && (
          <>
            <div className="controls">
              <form onSubmit={handleRangeSearch}>
                <div className="control-row">
                  <div className="field">
                    <label htmlFor="range-from">De la</label>
                    <input id="range-from" type="date" value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} />
                  </div>
                  <div className="field">
                    <label htmlFor="range-to">Până la</label>
                    <input id="range-to" type="date" value={rangeTo} onChange={e => setRangeTo(e.target.value)} />
                  </div>
                  <div className="field field-btn">
                    <label>&nbsp;</label>
                    <button type="submit" className="btn-search" disabled={rangeLoading}>
                      {rangeLoading ? 'Se caută...' : 'Caută'}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {rangeSearched && !rangeLoading && (
              rangeRecords.length === 0 ? (
                <div className="empty-state">Nicio prezență în intervalul selectat.</div>
              ) : (
                <>
                  <div className="stats-bar">
                    <span className="stat">
                      <strong>{rangeRecords.length}</strong> înregistrări,{' '}
                      <strong>{rangeByStudent.length}</strong> elevi unici
                    </span>
                    <button className="btn-action" onClick={exportRangeCSV}>⬇ CSV</button>
                  </div>
                  <div className="attendance-table-wrap">
                    <div className="istoric-result-header">
                      <strong>Frecvență — {currentTeacher?.subject}</strong>
                      <span className="istoric-count">{rangeFrom} → {rangeTo}</span>
                    </div>
                    <table className="attendance-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Prenume</th>
                          <th>Nume</th>
                          <th>Clasa</th>
                          <th>Zile prezent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rangeByStudent.map((s, i) => (
                          <tr key={`${s.prenume}|${s.nume}`}>
                            <td className="td-nr">{i + 1}</td>
                            <td>{s.prenume}</td>
                            <td>{s.nume}</td>
                            <td><span className="badge">{s.clasa}</span></td>
                            <td><strong style={{ color: 'var(--blue)' }}>{s.count}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            )}
          </>
        )}

        {/* ══════════════ TAB: RAPORT ELEV ══════════════ */}
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
                <>
                  {/* Sumar per materie */}
                  <div className="stats-summary">
                    {Object.entries(
                      istoricRecords.reduce<Record<string, number>>((acc, r) => {
                        const key = r.materie || 'Nespecificat';
                        acc[key] = (acc[key] || 0) + 1;
                        return acc;
                      }, {})
                    )
                      .sort((a, b) => b[1] - a[1])
                      .map(([subject, count]) => (
                        <div className="stat-card" key={subject}>
                          <div className="stat-card-value" style={{ fontSize: '1.6rem' }}>{count}</div>
                          <div className="stat-card-label">{subject}</div>
                        </div>
                      ))
                    }
                    <div className="stat-card" style={{ borderTop: '3px solid var(--blue)' }}>
                      <div className="stat-card-value">{istoricRecords.length}</div>
                      <div className="stat-card-label">Total prezențe</div>
                    </div>
                  </div>

                  <div className="attendance-table-wrap">
                    <div className="istoric-result-header">
                      <strong>{istoricPrenume} {istoricNume}</strong>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span className="istoric-count">{istoricRecords.length} prezențe</span>
                        <button className="btn-action" onClick={exportIstoricCSV}>⬇ CSV</button>
                      </div>
                    </div>
                    <table className="attendance-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Data</th>
                          <th>Clasa</th>
                          <th>Materie</th>
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
                            <td>
                              {r.materie
                                ? <span className="badge" style={{ background: 'var(--green-light)', color: 'var(--green)' }}>{r.materie}</span>
                                : <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>—</span>
                              }
                            </td>
                            <td className="td-time">
                              {r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}
