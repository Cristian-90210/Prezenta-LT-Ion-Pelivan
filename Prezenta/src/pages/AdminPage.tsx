import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../firebase';
import { TEACHERS, type Teacher } from '../teachers';
import { useConfig, DEFAULT_CLASSES } from '../hooks/useConfig';

type AdminTab = 'profesori' | 'clase' | 'elevi' | 'setari';

interface StudentRecord {
  uid: string;
  prenume: string;
  nume: string;
  clasa: string;
  email: string;
}

function normalizeId(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export default function AdminPage() {
  const { teachers, classes } = useConfig();

  const [loggedIn, setLoggedIn] = useState(() => {
    const t = sessionStorage.getItem('adminLoginTime');
    if (!t) return false;
    const remaining = 10 * 60 * 1000 - (Date.now() - Number(t));
    if (remaining <= 0) {
      sessionStorage.removeItem('adminLoginTime');
      sessionStorage.removeItem('adminLoggedIn');
      return false;
    }
    return sessionStorage.getItem('adminLoggedIn') === 'true';
  });
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [adminPass, setAdminPass] = useState<string | null>(null); // null = loading

  const [tab, setTab] = useState<AdminTab>('profesori');
  const [saving, setSaving] = useState(false);

  // Add teacher form
  const [newName, setNewName] = useState('');
  const [newSubject, setNewSubject] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [addTeacherError, setAddTeacherError] = useState('');

  // Add class form
  const [newClass, setNewClass] = useState('');
  const [addClassError, setAddClassError] = useState('');

  // Change admin password
  const [newAdminPass, setNewAdminPass] = useState('');
  const [passMsg, setPassMsg] = useState('');

  // Edit teacher modal
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [editName, setEditName]         = useState('');
  const [editSubject, setEditSubject]   = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editTeacherError, setEditTeacherError] = useState('');

  // Students tab
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [resetMsg, setResetMsg] = useState<Record<string, string>>({});
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Mobile sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Dark mode
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // ── Auto-logout după 10 minute (persistent prin sessionStorage) ──────────
  useEffect(() => {
    if (!loggedIn) return;
    const stored = sessionStorage.getItem('adminLoginTime');
    const loginTime = stored ? Number(stored) : Date.now();
    if (!stored) sessionStorage.setItem('adminLoginTime', String(loginTime));
    const remaining = 10 * 60 * 1000 - (Date.now() - loginTime);
    if (remaining <= 0) { handleAdminLogout(); return; }
    const timer = setTimeout(handleAdminLogout, remaining);
    return () => clearTimeout(timer);
  }, [loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load admin password from Firestore
  useEffect(() => {
    getDoc(doc(db, 'settings', 'admin'))
      .then(snap => {
        setAdminPass(snap.exists() && snap.data().password ? snap.data().password : 'admin2025');
      })
      .catch(() => setAdminPass('admin2025'));
  }, []);

  function handleAdminLogout() {
    sessionStorage.removeItem('adminLoginTime');
    sessionStorage.removeItem('adminLoggedIn');
    setLoggedIn(false);
    setSidebarOpen(false);
  }

  function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (adminPass === null) return;
    if (password === adminPass) {
      sessionStorage.setItem('adminLoginTime', String(Date.now()));
      sessionStorage.setItem('adminLoggedIn', 'true');
      setLoggedIn(true);
      setLoginError('');
    } else {
      setLoginError('Parolă admin incorectă.');
    }
  }

  async function saveTeachers(updated: Teacher[]) {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'config'), { teachers: updated }, { merge: true });
    } finally {
      setSaving(false);
    }
  }

  async function saveClasses(updated: string[]) {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'config'), { classes: updated }, { merge: true });
    } finally {
      setSaving(false);
    }
  }

  async function handleAddTeacher(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    const subject = newSubject.trim();
    const pass = newPassword.trim();
    if (!name || !subject || !pass) {
      setAddTeacherError('Toate câmpurile sunt obligatorii.');
      return;
    }
    const id = normalizeId(subject);
    if (teachers.some(t => t.id === id)) {
      setAddTeacherError(`ID-ul "${id}" există deja. Folosiți o materie diferită sau mai specifică.`);
      return;
    }
    setAddTeacherError('');
    await saveTeachers([...teachers, { id, name, subject, password: pass }]);
    setNewName('');
    setNewSubject('');
    setNewPassword('');
  }

  async function handleDeleteTeacher(id: string) {
    await saveTeachers(teachers.filter(t => t.id !== id));
  }

  function openEditTeacher(t: Teacher) {
    setEditingTeacher(t);
    setEditName(t.name);
    setEditSubject(t.subject);
    setEditPassword(t.password);
    setEditTeacherError('');
  }

  async function handleSaveEditTeacher(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTeacher) return;
    const name    = editName.trim();
    const subject = editSubject.trim();
    const pass    = editPassword.trim();
    if (!name || !subject || !pass) {
      setEditTeacherError('Toate câmpurile sunt obligatorii.');
      return;
    }
    const updated = teachers.map(t =>
      t.id === editingTeacher.id ? { ...t, name, subject, password: pass } : t
    );
    await saveTeachers(updated);
    setEditingTeacher(null);
  }

  async function handleAddClass(e: React.FormEvent) {
    e.preventDefault();
    const cls = newClass.trim().toUpperCase();
    if (!cls) { setAddClassError('Introduceți o clasă.'); return; }
    if (classes.includes(cls)) { setAddClassError('Clasa există deja.'); return; }
    setAddClassError('');
    await saveClasses([...classes, cls]);
    setNewClass('');
  }

  async function handleDeleteClass(cls: string) {
    await saveClasses(classes.filter(c => c !== cls));
  }

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    setStudentsError('');
    try {
      const snap = await getDocs(collection(db, 'students'));
      const data: StudentRecord[] = snap.docs.map(d => ({
        uid: d.id,
        prenume: d.data().prenume ?? '',
        nume:    d.data().nume    ?? '',
        clasa:   d.data().clasa   ?? '',
        email:   d.data().email   ?? '',
      })).sort((a, b) => a.nume.localeCompare(b.nume));
      setStudents(data);
    } catch {
      setStudentsError('Nu s-au putut încărca elevii. Verificați regulile Firestore (allow read: if true pentru /students/{uid}).');
    }
    setStudentsLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'elevi' && loggedIn) loadStudents();
  }, [tab, loggedIn, loadStudents]);

  async function handleResetPassword(student: StudentRecord) {
    try {
      await sendPasswordResetEmail(auth, student.email);
      setResetMsg(m => ({ ...m, [student.uid]: '✓ Email trimis!' }));
    } catch {
      setResetMsg(m => ({ ...m, [student.uid]: 'Eroare la trimitere.' }));
    }
    setTimeout(() => setResetMsg(m => { const n = { ...m }; delete n[student.uid]; return n; }), 3000);
  }

  async function handleDeleteStudent(uid: string) {
    try {
      await deleteDoc(doc(db, 'students', uid));
      setStudents(s => s.filter(st => st.uid !== uid));
      setDeleteConfirm(null);
    } catch {
      alert('Eroare la ștergere.');
    }
  }

  async function handleChangeAdminPass(e: React.FormEvent) {
    e.preventDefault();
    const p = newAdminPass.trim();
    if (p.length < 6) { setPassMsg('Parola trebuie să aibă cel puțin 6 caractere.'); return; }
    try {
      await setDoc(doc(db, 'settings', 'admin'), { password: p });
      setAdminPass(p);
      setNewAdminPass('');
      setPassMsg('✓ Parola a fost schimbată cu succes!');
    } catch {
      setPassMsg('Eroare la salvare. Încearcă din nou.');
    }
  }

  // ── Login ─────────────────────────────────────────────────────────────────
  if (!loggedIn) {
    return (
      <div className="page-center">
        <div className="card">
          <div className="card-header" style={{ background: '#7c3aed' }}>
            <div className="school-icon">🛡️</div>
            <h1>Panou Administrator</h1>
            <p className="subtitle">Acces restricționat</p>
          </div>
          <form onSubmit={handleLogin} className="form">
            <div className="field">
              <label htmlFor="admin-pass">Parolă administrator</label>
              <input
                id="admin-pass"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Parola admin"
                autoFocus
                disabled={adminPass === null}
              />
            </div>
            {loginError && <p className="error-msg">{loginError}</p>}
            <button
              type="submit"
              className="btn-primary"
              style={{ background: '#7c3aed' }}
              disabled={adminPass === null}
            >
              {adminPass === null ? 'Se încarcă...' : 'Intră'}
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

  const ADMIN_TABS: { id: AdminTab; icon: string; label: string }[] = [
    { id: 'profesori', icon: '👩‍🏫', label: 'Profesori' },
    { id: 'clase',     icon: '🏫', label: 'Clase' },
    { id: 'elevi',     icon: '👨‍🎓', label: 'Elevi' },
    { id: 'setari',    icon: '⚙️', label: 'Setări' },
  ];

  // ── Dashboard ─────────────────────────────────────────────────────────────
  return (
    <div className="teacher-page">

      {/* ══════════ MOBILE SIDEBAR ══════════ */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)}>
          <div className="sidebar" onClick={e => e.stopPropagation()}>
            <div className="sidebar-header">
              <span className="sidebar-logo">🛡️ Administrator</span>
              <button className="sidebar-close" onClick={() => setSidebarOpen(false)}>✕</button>
            </div>
            <nav className="sidebar-nav">
              {ADMIN_TABS.map(item => (
                <button
                  key={item.id}
                  className={`sidebar-nav-item${tab === item.id ? ' active' : ''}`}
                  onClick={() => { setTab(item.id); setSidebarOpen(false); }}
                >
                  <span className="sidebar-nav-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="sidebar-footer">
              <div className="sidebar-toggle-row">
                <span className="sidebar-toggle-label">🌙 Mod întunecat</span>
                <label className="toggle-switch">
                  <input type="checkbox" checked={darkMode} onChange={() => setDarkMode(d => !d)} />
                  <span className="toggle-slider" />
                </label>
              </div>
              <button className="sidebar-logout" onClick={handleAdminLogout}>
                ↩ Deconectare
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ══════════ END SIDEBAR ══════════ */}

      <header className="teacher-header" style={{ background: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)' }}>
        <div className="header-content">
          <button className="btn-hamburger" onClick={() => setSidebarOpen(true)} aria-label="Meniu">☰</button>
          <div className="header-center-title">
            <span className="hct-subject">Administrator</span>
            <span className="hct-school">LT Ion Pelivan</span>
          </div>
          <div
            className="header-profile-btn"
            style={{ cursor: 'default', fontSize: '1.3rem' }}
            title="Administrator"
            aria-label="Administrator"
          >
            🛡
          </div>
        </div>
      </header>

      <div className="teacher-body">

        {/* ══ SIDEBAR PERMANENT (desktop) ══ */}
        <aside className="teacher-sidebar-fixed">
          <div className="tsf-profile">
            <div className="tsf-avatar">🛡</div>
            <div className="tsf-info">
              <span className="tsf-name">Administrator</span>
              <span className="tsf-badge" style={{ color: '#7c3aed', background: '#ede9fe' }}>Admin</span>
            </div>
          </div>

          <nav className="tsf-nav">
            {ADMIN_TABS.map(item => (
              <button
                key={item.id}
                className={`tsf-nav-item${tab === item.id ? ' active' : ''}`}
                onClick={() => setTab(item.id)}
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
            <button className="sidebar-logout" onClick={handleAdminLogout}>↩ Deconectare</button>
          </div>
        </aside>

        <main className="teacher-main">

        {/* ══ Tab: Profesori ══ */}
        {tab === 'profesori' && (
          <>
            <div className="controls">
              <h3 className="admin-section-title">Adaugă profesor nou</h3>
              <form onSubmit={handleAddTeacher}>
                <div className="control-row">
                  <div className="field">
                    <label>Nume afișat</label>
                    <input
                      type="text"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="ex: Prof. Matematică"
                      disabled={saving}
                    />
                  </div>
                  <div className="field">
                    <label>Materia predată</label>
                    <input
                      type="text"
                      value={newSubject}
                      onChange={e => setNewSubject(e.target.value)}
                      placeholder="ex: Matematică"
                      disabled={saving}
                    />
                  </div>
                  <div className="field">
                    <label>Parolă profesor</label>
                    <input
                      type="text"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="ex: mate2025"
                      disabled={saving}
                    />
                  </div>
                  <div className="field field-btn">
                    <label>&nbsp;</label>
                    <button
                      type="submit"
                      className="btn-search"
                      style={{ background: '#7c3aed' }}
                      disabled={saving}
                    >
                      {saving ? 'Se salvează...' : '+ Adaugă'}
                    </button>
                  </div>
                </div>
                {addTeacherError && (
                  <p className="error-msg" style={{ marginTop: 8 }}>{addTeacherError}</p>
                )}
              </form>
            </div>

            <div className="attendance-table-wrap">
              <div className="istoric-result-header">
                <strong>Profesori activi — {teachers.length} total</strong>
                <button
                  className="btn-action"
                  onClick={() => saveTeachers(TEACHERS)}
                  disabled={saving}
                >
                  Resetează la implicite
                </button>
              </div>
              <table className="attendance-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nume afișat</th>
                    <th>Materie</th>
                    <th>Parolă</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map(t => (
                    <tr key={t.id}>
                      <td className="td-ip">{t.id}</td>
                      <td>{t.name}</td>
                      <td><span className="badge">{t.subject}</span></td>
                      <td className="td-ip">{t.password}</td>
                      <td style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn-action"
                          onClick={() => openEditTeacher(t)}
                          disabled={saving}
                          title="Editează profesor"
                          style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                        >
                          ✏️
                        </button>
                        <button
                          className="btn-delete"
                          onClick={() => handleDeleteTeacher(t.id)}
                          disabled={saving}
                          title="Șterge profesor"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ══ Tab: Clase ══ */}
        {tab === 'clase' && (
          <>
            <div className="controls">
              <h3 className="admin-section-title">Adaugă clasă nouă</h3>
              <form onSubmit={handleAddClass}>
                <div className="control-row">
                  <div className="field">
                    <label>Denumire clasă (ex: IX-D, X-INFO)</label>
                    <input
                      type="text"
                      value={newClass}
                      onChange={e => setNewClass(e.target.value)}
                      placeholder="ex: IX-D"
                      disabled={saving}
                    />
                  </div>
                  <div className="field field-btn">
                    <label>&nbsp;</label>
                    <button
                      type="submit"
                      className="btn-search"
                      style={{ background: '#7c3aed' }}
                      disabled={saving}
                    >
                      {saving ? 'Se salvează...' : '+ Adaugă clasă'}
                    </button>
                  </div>
                </div>
                {addClassError && (
                  <p className="error-msg" style={{ marginTop: 8 }}>{addClassError}</p>
                )}
              </form>
            </div>

            <div className="attendance-table-wrap">
              <div className="istoric-result-header">
                <strong>Clase active — {classes.length} total</strong>
                <button
                  className="btn-action"
                  onClick={() => saveClasses(DEFAULT_CLASSES)}
                  disabled={saving}
                >
                  Resetează la implicite
                </button>
              </div>
              <div className="admin-classes-grid">
                {classes.map(cls => (
                  <div className="admin-class-tag" key={cls}>
                    <span className="badge">{cls}</span>
                    <button
                      className="admin-class-delete"
                      onClick={() => handleDeleteClass(cls)}
                      disabled={saving}
                      title={`Șterge ${cls}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ══ Tab: Elevi ══ */}
        {tab === 'elevi' && (
          <>
            {/* Search */}
            <div className="controls">
              <div className="control-row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 1 }}>
                  <label>Caută elev (nume, clasă sau email)</label>
                  <input
                    type="text"
                    value={studentSearch}
                    onChange={e => setStudentSearch(e.target.value)}
                    placeholder="ex: Popescu sau X-A"
                  />
                </div>
                <div className="field field-btn">
                  <label>&nbsp;</label>
                  <button className="btn-search" style={{ background: '#7c3aed' }} onClick={loadStudents}>
                    ↻ Reîncarcă
                  </button>
                </div>
              </div>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 8 }}>
                ⚠️ Dacă apare eroare, adaugă în Firestore Rules:{' '}
                <code style={{ background: 'var(--gray-100)', padding: '1px 5px', borderRadius: 3 }}>
                  match /students/&#123;uid&#125; &#123; allow read: if true; &#125;
                </code>
              </p>
            </div>

            {studentsLoading && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                Se încarcă elevii...
              </div>
            )}

            {studentsError && (
              <div className="firebase-error">
                <strong>Eroare</strong>
                <p>{studentsError}</p>
              </div>
            )}

            {!studentsLoading && !studentsError && (
              <div className="attendance-table-wrap">
                <div className="istoric-result-header">
                  <strong>
                    {(() => {
                      const filtered = students.filter(s => {
                        const q = studentSearch.toLowerCase();
                        return !q || s.prenume.toLowerCase().includes(q) ||
                          s.nume.toLowerCase().includes(q) ||
                          s.clasa.toLowerCase().includes(q) ||
                          s.email.toLowerCase().includes(q);
                      });
                      return `${filtered.length} elev${filtered.length !== 1 ? 'i' : ''} găsit${filtered.length !== 1 ? 'i' : ''}`;
                    })()}
                  </strong>
                </div>
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Nume</th>
                      <th>Clasă</th>
                      <th>Email</th>
                      <th>Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students
                      .filter(s => {
                        const q = studentSearch.toLowerCase();
                        return !q || s.prenume.toLowerCase().includes(q) ||
                          s.nume.toLowerCase().includes(q) ||
                          s.clasa.toLowerCase().includes(q) ||
                          s.email.toLowerCase().includes(q);
                      })
                      .map((s, i) => (
                        <tr key={s.uid}>
                          <td className="td-nr">{i + 1}</td>
                          <td><strong>{s.prenume} {s.nume}</strong></td>
                          <td><span className="badge">{s.clasa}</span></td>
                          <td className="td-ip">{s.email}</td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                              {resetMsg[s.uid] ? (
                                <span style={{
                                  fontSize: '0.78rem', fontWeight: 700,
                                  color: resetMsg[s.uid].startsWith('✓') ? 'var(--green)' : 'var(--rose)',
                                }}>
                                  {resetMsg[s.uid]}
                                </span>
                              ) : (
                                <button
                                  className="btn-action"
                                  style={{ fontSize: '0.75rem', padding: '5px 10px' }}
                                  onClick={() => handleResetPassword(s)}
                                  title="Trimite email de resetare parolă"
                                >
                                  🔑 Reset parolă
                                </button>
                              )}
                              {deleteConfirm === s.uid ? (
                                <>
                                  <button
                                    className="btn-delete"
                                    onClick={() => handleDeleteStudent(s.uid)}
                                    title="Confirmă ștergerea"
                                  >
                                    ✓ Confirm
                                  </button>
                                  <button
                                    className="btn-action"
                                    style={{ fontSize: '0.75rem', padding: '5px 8px' }}
                                    onClick={() => setDeleteConfirm(null)}
                                  >
                                    Anulează
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="btn-delete"
                                  onClick={() => setDeleteConfirm(s.uid)}
                                  title="Șterge cont elev"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    {students.length === 0 && !studentsLoading && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                          Niciun elev înregistrat încă.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ══ Tab: Setări ══ */}
        {tab === 'setari' && (
          <div className="controls">
            <h3 className="admin-section-title">Schimbă parola administrator</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              Parola implicită este{' '}
              <code style={{ background: 'var(--gray-100)', padding: '2px 6px', borderRadius: 4 }}>
                admin2025
              </code>
              . Schimbați-o la prima autentificare.
            </p>
            <form onSubmit={handleChangeAdminPass}>
              <div className="control-row">
                <div className="field">
                  <label>Parolă nouă (min. 6 caractere)</label>
                  <input
                    type="password"
                    value={newAdminPass}
                    onChange={e => setNewAdminPass(e.target.value)}
                    placeholder="Parolă nouă"
                  />
                </div>
                <div className="field field-btn">
                  <label>&nbsp;</label>
                  <button
                    type="submit"
                    className="btn-search"
                    style={{ background: '#7c3aed' }}
                  >
                    Schimbă parola
                  </button>
                </div>
              </div>
              {passMsg && (
                <p
                  className={passMsg.startsWith('✓') ? 'success-msg' : 'error-msg'}
                  style={{ marginTop: 8 }}
                >
                  {passMsg}
                </p>
              )}
            </form>
          </div>
        )}

      </main>
      </div>

      {/* ══ Modal editare profesor ══ */}
      {editingTeacher && (
        <div className="modal-overlay" onClick={() => setEditingTeacher(null)}>
          <div className="crop-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="crop-modal-header">
              <span className="crop-modal-title">Editează profesor</span>
              <button className="qr-zoom-close" onClick={() => setEditingTeacher(null)}>✕</button>
            </div>
            <form onSubmit={handleSaveEditTeacher} className="crop-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '20px 24px' }}>
              <div className="field">
                <label>Nume afișat</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="ex: Prof. Matematică"
                  autoFocus
                  disabled={saving}
                />
              </div>
              <div className="field">
                <label>Materia predată</label>
                <input
                  type="text"
                  value={editSubject}
                  onChange={e => setEditSubject(e.target.value)}
                  placeholder="ex: Matematică"
                  disabled={saving}
                />
              </div>
              <div className="field">
                <label>Parolă</label>
                <input
                  type="text"
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  placeholder="ex: mate2025"
                  disabled={saving}
                />
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                ID-ul profesorului (<code style={{ background: 'var(--gray-100)', padding: '1px 5px', borderRadius: 4 }}>{editingTeacher.id}</code>) nu se poate schimba.
              </p>
              {editTeacherError && <p className="error-msg">{editTeacherError}</p>}
              <div className="crop-modal-footer" style={{ padding: 0, marginTop: 4 }}>
                <button type="button" className="btn-cancel-sm" style={{ padding: '10px 24px' }} onClick={() => setEditingTeacher(null)}>
                  Anulează
                </button>
                <button type="submit" className="btn-primary" style={{ width: 'auto', padding: '10px 28px', background: '#7c3aed' }} disabled={saving}>
                  {saving ? 'Se salvează...' : 'Salvează'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
