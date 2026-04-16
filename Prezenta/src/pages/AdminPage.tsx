import { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc, query, orderBy, limit, addDoc, Timestamp } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../firebase';
import { TEACHERS, type Teacher } from '../teachers';
import { useConfig, DEFAULT_CLASSES } from '../hooks/useConfig';
import { useSort } from '../hooks/useSort';
import { logAudit } from '../utils/auditLog';
import type { AuditAction } from '../utils/auditLog';
import type { OraDeClasa, Schimbare } from '../types';

type AdminTab = 'profesori' | 'clase' | 'elevi' | 'orar' | 'audit' | 'setari';

interface AuditEntry {
  id: string;
  timestamp: { toDate(): Date } | null;
  actor: string;
  action: AuditAction;
  details: Record<string, string>;
}

const ACTION_META: Record<string, { label: string; icon: string; color: string }> = {
  add_teacher:           { label: 'Profesor adăugat',       icon: '➕', color: '#16a34a' },
  delete_teacher:        { label: 'Profesor șters',          icon: '🗑️', color: '#dc2626' },
  edit_teacher:          { label: 'Profesor editat',         icon: '✏️', color: '#2563eb' },
  add_class:             { label: 'Clasă adăugată',          icon: '➕', color: '#16a34a' },
  delete_class:          { label: 'Clasă ștearsă',           icon: '🗑️', color: '#dc2626' },
  delete_student:        { label: 'Elev șters',              icon: '🗑️', color: '#dc2626' },
  reset_password:        { label: 'Parolă resetată (elev)',  icon: '🔑', color: '#d97706' },
  change_admin_password: { label: 'Parolă admin schimbată', icon: '🔐', color: '#7c3aed' },
};

function formatDetails(details: Record<string, string>): string {
  return Object.entries(details)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

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

  // Vizibilitate parolă în tabel
  const [visiblePasswords, setVisiblePasswords] = useState<Set<string>>(new Set());
  function togglePasswordVisibility(id: string) {
    setVisiblePasswords(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

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

  // Audit log
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Orar
  const ZILE   = ['Luni', 'Marți', 'Miercuri', 'Joi', 'Vineri'] as const;
  const ORE_NR = [1, 2, 3, 4, 5, 6, 7, 8] as const;

  const DEFAULT_INTERVALE = [
    { ora: 1, start: '08:00', sfarsit: '08:50' },
    { ora: 2, start: '09:00', sfarsit: '09:50' },
    { ora: 3, start: '10:00', sfarsit: '10:50' },
    { ora: 4, start: '11:00', sfarsit: '11:50' },
    { ora: 5, start: '12:00', sfarsit: '12:50' },
    { ora: 6, start: '13:00', sfarsit: '13:50' },
    { ora: 7, start: '14:00', sfarsit: '14:50' },
    { ora: 8, start: '15:00', sfarsit: '15:50' },
  ];

  const [intervale, setIntervale]           = useState(DEFAULT_INTERVALE);
  const [intervaleSaving, setIntervaleSaving] = useState(false);
  const [intervaleMsg, setIntervaleMsg]     = useState('');
  const ORE_INTERVAL = intervale.map(i => `${i.start}–${i.sfarsit}`);

  const [orarOrarSubtab, setOrarOrarSubtab] = useState<'orar'|'schimbari'|'setari-orar'>('orar');
  const [orarClasa, setOrarClasa]           = useState('');
  const [orarOre, setOrarOre]               = useState<OraDeClasa[]>([]);
  const [orarLoading, setOrarLoading]       = useState(false);
  const [editCell, setEditCell]             = useState<{zi: string; ora: number} | null>(null);
  const [cellMaterie, setCellMaterie]       = useState('');
  const [cellProfesor, setCellProfesor]     = useState('');
  const [cellCabinet, setCellCabinet]       = useState('');
  const [cellSaving, setCellSaving]         = useState(false);
  const [cellError, setCellError]           = useState('');

  const [schimbari, setSchimbari]           = useState<Schimbare[]>([]);
  const [schimbariLoading, setSchimbariLoading] = useState(false);
  const [newSchData, setNewSchData]         = useState(new Date().toISOString().split('T')[0]);
  const [newSchClasa, setNewSchClasa]       = useState('Toate clasele');
  const [newSchTitlu, setNewSchTitlu]       = useState('');
  const [newSchDesc, setNewSchDesc]         = useState('');
  const [newSchMaterieVeche, setNewSchMaterieVeche] = useState('');
  const [newSchMaterieNoua, setNewSchMaterieNoua]   = useState('');
  const [schSaving, setSchSaving]           = useState(false);

  // ── Sortare tabele ────────────────────────────────────────────────────────
  const teachersSort = useSort(teachers, 'name', 'asc');

  const filteredStudents = useMemo(() => students.filter(s => {
    const q = studentSearch.toLowerCase();
    return !q || s.prenume.toLowerCase().includes(q) ||
      s.nume.toLowerCase().includes(q) ||
      s.clasa.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q);
  }), [students, studentSearch]);
  const studentsSort = useSort(filteredStudents, 'prenume', 'asc');

  // ── Paginare elevi ────────────────────────────────────────────────────────
  const STUDENTS_PAGE_SIZE = 50;
  const [studentsPage, setStudentsPage] = useState(0);

  // Reset la pagina 1 când se schimbă căutarea sau sortarea
  useEffect(() => { setStudentsPage(0); }, [studentSearch, studentsSort.col, studentsSort.dir]);

  const totalPages = Math.ceil(studentsSort.sorted.length / STUDENTS_PAGE_SIZE);
  const pagedStudents = studentsSort.sorted.slice(
    studentsPage * STUDENTS_PAGE_SIZE,
    (studentsPage + 1) * STUDENTS_PAGE_SIZE,
  );

  // Mobile sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Dark mode
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') !== 'false');
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

  // ── Intervale functions ───────────────────────────────────────────────────
  async function loadIntervale() {
    try {
      const snap = await getDoc(doc(db, 'settings', 'orar'));
      if (snap.exists() && snap.data().intervale) setIntervale(snap.data().intervale);
    } catch {}
  }

  async function saveIntervale() {
    setIntervaleSaving(true);
    setIntervaleMsg('');
    try {
      await setDoc(doc(db, 'settings', 'orar'), { intervale });
      setIntervaleMsg('✓ Salvat!');
    } catch {
      setIntervaleMsg('Eroare la salvare.');
    }
    setIntervaleSaving(false);
    setTimeout(() => setIntervaleMsg(''), 3000);
  }

  // ── Orar functions ────────────────────────────────────────────────────────
  async function loadOrar(clasa: string) {
    if (!clasa) return;
    setOrarLoading(true);
    try {
      const snap = await getDoc(doc(db, 'orar', clasa));
      setOrarOre(snap.exists() ? (snap.data().ore ?? []) : []);
    } catch {}
    setOrarLoading(false);
  }

  function openCell(zi: string, ora: number) {
    const existing = orarOre.find(o => o.zi === zi && o.ora === ora);
    setCellMaterie(existing?.materie ?? '');
    setCellProfesor(existing?.profesor ?? '');
    setCellCabinet(existing?.cabinet ?? '');
    setCellError('');
    setEditCell({ zi, ora });
  }

  async function saveCell() {
    if (!editCell || !orarClasa) return;
    setCellSaving(true);
    setCellError('');
    let newOre: OraDeClasa[];
    const exists = orarOre.find(o => o.zi === editCell.zi && o.ora === editCell.ora);
    if (!cellMaterie.trim()) {
      newOre = orarOre.filter(o => !(o.zi === editCell.zi && o.ora === editCell.ora));
    } else if (exists) {
      newOre = orarOre.map(o => o.zi === editCell.zi && o.ora === editCell.ora
        ? { ...o, materie: cellMaterie.trim(), profesor: cellProfesor.trim(), cabinet: cellCabinet.trim() }
        : o);
    } else {
      newOre = [...orarOre, {
        id: `${editCell.zi}-${editCell.ora}-${Date.now()}`,
        zi: editCell.zi, ora: editCell.ora,
        materie: cellMaterie.trim(), profesor: cellProfesor.trim(), cabinet: cellCabinet.trim(),
      }];
    }
    try {
      await setDoc(doc(db, 'orar', orarClasa), { ore: newOre });
      setOrarOre(newOre);
      setEditCell(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCellError(`Eroare la salvare: ${msg}`);
      console.error('saveCell error:', err);
    }
    setCellSaving(false);
  }

  async function deleteCell() {
    if (!editCell || !orarClasa) return;
    setCellSaving(true);
    setCellError('');
    const newOre = orarOre.filter(o => !(o.zi === editCell.zi && o.ora === editCell.ora));
    try {
      await setDoc(doc(db, 'orar', orarClasa), { ore: newOre });
      setOrarOre(newOre);
      setEditCell(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCellError(`Eroare la ștergere: ${msg}`);
      console.error('deleteCell error:', err);
    }
    setCellSaving(false);
  }

  // ── Schimbări functions ───────────────────────────────────────────────────
  async function loadSchimbari() {
    setSchimbariLoading(true);
    try {
      const snap = await getDocs(collection(db, 'schimbari'));
      const data = snap.docs.map(d => ({
        id: d.id,
        data: d.data().data ?? '',
        clasa: d.data().clasa ?? '',
        titlu: d.data().titlu ?? '',
        descriere: d.data().descriere ?? '',
        materieVeche: d.data().materieVeche ?? '',
        materieNoua: d.data().materieNoua ?? '',
        creatLa: d.data().creatLa?.toDate() ?? new Date(),
      }));
      data.sort((a, b) => b.creatLa.getTime() - a.creatLa.getTime());
      setSchimbari(data);
    } catch {}
    setSchimbariLoading(false);
  }

  async function addSchimbare(e: React.FormEvent) {
    e.preventDefault();
    if (!newSchTitlu.trim()) return;
    setSchSaving(true);
    try {
      const payload: Record<string, unknown> = {
        data: newSchData, clasa: newSchClasa,
        titlu: newSchTitlu.trim(), descriere: newSchDesc.trim(),
        materieVeche: newSchMaterieVeche.trim(),
        materieNoua: newSchMaterieNoua.trim(),
        creatLa: Timestamp.now(),
      };
      const ref = await addDoc(collection(db, 'schimbari'), payload);
      setSchimbari(prev => [{
        id: ref.id, data: newSchData, clasa: newSchClasa,
        titlu: newSchTitlu.trim(), descriere: newSchDesc.trim(),
        materieVeche: newSchMaterieVeche.trim(), materieNoua: newSchMaterieNoua.trim(),
        creatLa: new Date(),
      }, ...prev]);
      setNewSchTitlu(''); setNewSchDesc('');
      setNewSchMaterieVeche(''); setNewSchMaterieNoua('');
    } catch {}
    setSchSaving(false);
  }

  async function deleteSchimbare(id: string) {
    try {
      await deleteDoc(doc(db, 'schimbari', id));
      setSchimbari(prev => prev.filter(s => s.id !== id));
    } catch {}
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
    await logAudit('add_teacher', { id, nume: name, materie: subject });
    setNewName('');
    setNewSubject('');
    setNewPassword('');
  }

  async function handleDeleteTeacher(id: string) {
    const t = teachers.find(t => t.id === id);
    await saveTeachers(teachers.filter(t => t.id !== id));
    if (t) await logAudit('delete_teacher', { id, nume: t.name, materie: t.subject });
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
    await logAudit('edit_teacher', { id: editingTeacher.id, nume: name, materie: subject });
    setEditingTeacher(null);
  }

  async function handleAddClass(e: React.FormEvent) {
    e.preventDefault();
    const cls = newClass.trim().toUpperCase();
    if (!cls) { setAddClassError('Introduceți o clasă.'); return; }
    if (classes.includes(cls)) { setAddClassError('Clasa există deja.'); return; }
    setAddClassError('');
    await saveClasses([...classes, cls]);
    await logAudit('add_class', { clasa: cls });
    setNewClass('');
  }

  async function handleDeleteClass(cls: string) {
    await saveClasses(classes.filter(c => c !== cls));
    await logAudit('delete_class', { clasa: cls });
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

  const loadAuditLog = useCallback(async () => {
    setAuditLoading(true);
    try {
      const q = query(collection(db, 'audit_log'), orderBy('timestamp', 'desc'), limit(100));
      const snap = await getDocs(q);
      setAuditEntries(snap.docs.map(d => ({
        id: d.id,
        timestamp: d.data().timestamp ?? null,
        actor: d.data().actor ?? 'admin',
        action: d.data().action as AuditAction,
        details: d.data().details ?? {},
      })));
    } catch {
      setAuditEntries([]);
    }
    setAuditLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'audit' && loggedIn) loadAuditLog();
  }, [tab, loggedIn, loadAuditLog]);

  useEffect(() => {
    if (tab === 'orar' && loggedIn) { loadSchimbari(); loadIntervale(); }
  }, [tab, loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleResetPassword(student: StudentRecord) {
    try {
      await sendPasswordResetEmail(auth, student.email);
      setResetMsg(m => ({ ...m, [student.uid]: '✓ Email trimis!' }));
      await logAudit('reset_password', { nume: `${student.prenume} ${student.nume}`, email: student.email, clasa: student.clasa });
    } catch {
      setResetMsg(m => ({ ...m, [student.uid]: 'Eroare la trimitere.' }));
    }
    setTimeout(() => setResetMsg(m => { const n = { ...m }; delete n[student.uid]; return n; }), 3000);
  }

  async function handleDeleteStudent(uid: string) {
    try {
      const student = students.find(s => s.uid === uid);
      await deleteDoc(doc(db, 'students', uid));
      if (student) await logAudit('delete_student', { nume: `${student.prenume} ${student.nume}`, email: student.email, clasa: student.clasa });
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
      await logAudit('change_admin_password', {});
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
    { id: 'clase',     icon: '🏫',  label: 'Clase' },
    { id: 'elevi',     icon: '👨‍🎓', label: 'Elevi' },
    { id: 'orar',      icon: '📅',  label: 'Orar' },
    { id: 'audit',     icon: '📋',  label: 'Audit' },
    { id: 'setari',    icon: '⚙️',  label: 'Setări' },
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
              <span className="tsf-badge badge--purple">Admin</span>
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
                    <th className="th-sort" onClick={() => teachersSort.toggle('id')}>ID <span className="sort-icon">{teachersSort.icon('id')}</span></th>
                    <th className="th-sort" onClick={() => teachersSort.toggle('name')}>Nume afișat <span className="sort-icon">{teachersSort.icon('name')}</span></th>
                    <th className="th-sort" onClick={() => teachersSort.toggle('subject')}>Materie <span className="sort-icon">{teachersSort.icon('subject')}</span></th>
                    <th>Parolă</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {teachersSort.sorted.map(t => (
                    <tr key={t.id}>
                      <td className="td-ip">{t.id}</td>
                      <td>{t.name}</td>
                      <td><span className="badge">{t.subject}</span></td>
                      <td className="td-ip">
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontFamily: 'monospace' }}>
                            {visiblePasswords.has(t.id) ? t.password : '••••••••'}
                          </span>
                          <button
                            className="btn-edit"
                            onClick={() => togglePasswordVisibility(t.id)}
                            title={visiblePasswords.has(t.id) ? 'Ascunde parola' : 'Arată parola'}
                            style={{ fontSize: '0.85rem', padding: '2px 6px' }}
                          >
                            {visiblePasswords.has(t.id) ? '🙈' : '👁'}
                          </button>
                        </span>
                      </td>
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
                    {studentsSort.sorted.length} elev{studentsSort.sorted.length !== 1 ? 'i' : ''} găsit{studentsSort.sorted.length !== 1 ? 'i' : ''}
                    {totalPages > 1 && ` · pagina ${studentsPage + 1} din ${totalPages}`}
                  </strong>
                </div>
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="th-sort" onClick={() => studentsSort.toggle('prenume')}>Nume <span className="sort-icon">{studentsSort.icon('prenume')}</span></th>
                      <th className="th-sort" onClick={() => studentsSort.toggle('clasa')}>Clasă <span className="sort-icon">{studentsSort.icon('clasa')}</span></th>
                      <th className="th-sort" onClick={() => studentsSort.toggle('email')}>Email <span className="sort-icon">{studentsSort.icon('email')}</span></th>
                      <th>Acțiuni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedStudents.map((s, i) => (
                        <tr key={s.uid}>
                          <td className="td-nr">{studentsPage * STUDENTS_PAGE_SIZE + i + 1}</td>
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

                {totalPages > 1 && (
                  <div className="pagination-row">
                    <button
                      className="btn-action"
                      onClick={() => setStudentsPage(0)}
                      disabled={studentsPage === 0}
                    >
                      «
                    </button>
                    <button
                      className="btn-action"
                      onClick={() => setStudentsPage(p => p - 1)}
                      disabled={studentsPage === 0}
                    >
                      ‹ Anterior
                    </button>
                    <span className="pagination-info">
                      {studentsPage + 1} / {totalPages}
                    </span>
                    <button
                      className="btn-action"
                      onClick={() => setStudentsPage(p => p + 1)}
                      disabled={studentsPage >= totalPages - 1}
                    >
                      Următor ›
                    </button>
                    <button
                      className="btn-action"
                      onClick={() => setStudentsPage(totalPages - 1)}
                      disabled={studentsPage >= totalPages - 1}
                    >
                      »
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ══ Tab: Orar ══ */}
        {tab === 'orar' && (
          <>
            {/* Sub-tab switcher */}
            <div className="orar-subtabs">
              <button className={`orar-subtab${orarOrarSubtab === 'orar' ? ' active' : ''}`} onClick={() => setOrarOrarSubtab('orar')}>📅 Orar clase</button>
              <button className={`orar-subtab${orarOrarSubtab === 'schimbari' ? ' active' : ''}`} onClick={() => setOrarOrarSubtab('schimbari')}>🔄 Schimbări</button>
              <button className={`orar-subtab${orarOrarSubtab === 'setari-orar' ? ' active' : ''}`} onClick={() => setOrarOrarSubtab('setari-orar')}>⏰ Ore</button>
            </div>

            {/* ── Orar clase ── */}
            {orarOrarSubtab === 'orar' && (
              <>
                <div className="controls">
                  <h3 className="admin-section-title">Orar pe clase</h3>
                  <div className="control-row">
                    <div className="field">
                      <label>Selectează clasa</label>
                      <select
                        value={orarClasa}
                        onChange={e => { setOrarClasa(e.target.value); loadOrar(e.target.value); setEditCell(null); }}
                      >
                        <option value="">— Alege clasa —</option>
                        {classes.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {orarClasa && (
                  <>
                    {orarLoading ? (
                      <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>Se încarcă orarul...</div>
                    ) : (
                      <div className="orar-wrap">
                        <div className="orar-grid-scroll">
                          <table className="orar-table">
                            <thead>
                              <tr>
                                <th className="orar-th-ora">Ora</th>
                                {ZILE.map(zi => <th key={zi} className="orar-th-zi">{zi}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {ORE_NR.map((nr, idx) => (
                                <tr key={nr}>
                                  <td className="orar-td-nr">
                                    <strong>{nr}</strong>
                                    <span className="orar-interval">{ORE_INTERVAL[idx]}</span>
                                  </td>
                                  {ZILE.map(zi => {
                                    const ora = orarOre.find(o => o.zi === zi && o.ora === nr);
                                    const isEditing = editCell?.zi === zi && editCell?.ora === nr;
                                    return (
                                      <td
                                        key={zi}
                                        className={`orar-td-cell${isEditing ? ' editing' : ''}${ora ? ' filled' : ''}`}
                                        onClick={() => !isEditing && openCell(zi, nr)}
                                      >
                                        {ora ? (
                                          <>
                                            <span className="orar-materie">{ora.materie}</span>
                                            {ora.profesor && <span className="orar-profesor">{ora.profesor}</span>}
                                            {ora.cabinet && <span className="orar-cabinet">Cab. {ora.cabinet}</span>}
                                          </>
                                        ) : (
                                          <span className="orar-empty">+</span>
                                        )}
                                      </td>
                                    );
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {/* Edit panel */}
                        {editCell && (
                          <div className="orar-edit-panel">
                            <h4 className="orar-edit-title">
                              {editCell.zi} · Ora {editCell.ora} ({ORE_INTERVAL[editCell.ora - 1]})
                            </h4>
                            <div className="control-row" style={{ flexWrap: 'wrap' }}>
                              <div className="field" style={{ flex: '1 1 160px' }}>
                                <label>Materie</label>
                                <input
                                  type="text" value={cellMaterie}
                                  onChange={e => setCellMaterie(e.target.value)}
                                  placeholder="ex: Matematică"
                                  autoFocus
                                />
                              </div>
                              <div className="field" style={{ flex: '1 1 160px' }}>
                                <label>Profesor</label>
                                <input
                                  type="text" value={cellProfesor}
                                  onChange={e => setCellProfesor(e.target.value)}
                                  placeholder="ex: Ion Popescu"
                                />
                              </div>
                              <div className="field" style={{ flex: '1 1 100px' }}>
                                <label>Cabinet</label>
                                <input
                                  type="text" value={cellCabinet}
                                  onChange={e => setCellCabinet(e.target.value)}
                                  placeholder="ex: 201"
                                />
                              </div>
                            </div>
                            {cellError && (
                              <p style={{ color: 'var(--rose)', fontSize: '0.82rem', margin: '4px 0 0' }}>
                                {cellError}
                              </p>
                            )}
                            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                              <button className="btn-primary" onClick={saveCell} disabled={cellSaving} style={{ flex: 1 }}>
                                {cellSaving ? 'Se salvează...' : '✓ Salvează'}
                              </button>
                              {orarOre.find(o => o.zi === editCell.zi && o.ora === editCell.ora) && (
                                <button className="btn-delete" onClick={deleteCell} disabled={cellSaving} title="Șterge ora">
                                  ✕ Șterge
                                </button>
                              )}
                              <button className="btn-action" onClick={() => setEditCell(null)} disabled={cellSaving}>
                                Anulează
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                {!orarClasa && (
                  <div className="empty-state">Selectează o clasă pentru a edita orarul.</div>
                )}
              </>
            )}

            {/* ── Setări ore ── */}
            {orarOrarSubtab === 'setari-orar' && (
              <div className="controls">
                <h3 className="admin-section-title">Configurare ore (start – sfârșit)</h3>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16 }}>
                  Modifică orele de început și sfârșit pentru fiecare pereche. Salvează pentru a actualiza orarul tuturor claselor.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {intervale.map((iv, idx) => (
                    <div key={iv.ora} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 800, minWidth: 50, color: 'var(--indigo)' }}>Ora {iv.ora}</span>
                      <div className="field" style={{ margin: 0, flex: '0 0 130px' }}>
                        <label>Start</label>
                        <input
                          type="time" value={iv.start}
                          onChange={e => setIntervale(prev => prev.map((x, i) => i === idx ? { ...x, start: e.target.value } : x))}
                        />
                      </div>
                      <span style={{ color: 'var(--text-muted)', paddingTop: 20 }}>–</span>
                      <div className="field" style={{ margin: 0, flex: '0 0 130px' }}>
                        <label>Sfârșit</label>
                        <input
                          type="time" value={iv.sfarsit}
                          onChange={e => setIntervale(prev => prev.map((x, i) => i === idx ? { ...x, sfarsit: e.target.value } : x))}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button className="btn-primary" onClick={saveIntervale} disabled={intervaleSaving}>
                    {intervaleSaving ? 'Se salvează...' : '✓ Salvează orele'}
                  </button>
                  {intervaleMsg && (
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: intervaleMsg.startsWith('✓') ? 'var(--green)' : 'var(--rose)' }}>
                      {intervaleMsg}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* ── Schimbări ── */}
            {orarOrarSubtab === 'schimbari' && (
              <>
                <div className="controls">
                  <h3 className="admin-section-title">Adaugă schimbare</h3>
                  <form onSubmit={addSchimbare}>
                    <div className="control-row" style={{ flexWrap: 'wrap' }}>
                      <div className="field" style={{ flex: '0 0 150px' }}>
                        <label>Data</label>
                        <input type="date" value={newSchData} onChange={e => setNewSchData(e.target.value)} />
                      </div>
                      <div className="field" style={{ flex: '0 0 160px' }}>
                        <label>Clasa afectată</label>
                        <select value={newSchClasa} onChange={e => setNewSchClasa(e.target.value)}>
                          <option value="Toate clasele">Toate clasele</option>
                          {classes.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <div className="field" style={{ flex: '1 1 200px' }}>
                        <label>Titlu</label>
                        <input
                          type="text" value={newSchTitlu}
                          onChange={e => setNewSchTitlu(e.target.value)}
                          placeholder="ex: Ora de matematică anulată"
                          required
                        />
                      </div>
                    </div>
                    <div className="control-row" style={{ flexWrap: 'wrap' }}>
                      <div className="field" style={{ flex: '1 1 180px' }}>
                        <label>Materie înlocuită (opțional)</label>
                        <input
                          type="text" value={newSchMaterieVeche}
                          onChange={e => setNewSchMaterieVeche(e.target.value)}
                          placeholder="ex: Matematică"
                        />
                      </div>
                      <div className="field" style={{ flex: '0 0 36px', display: 'flex', alignItems: 'flex-end', paddingBottom: 2, justifyContent: 'center' }}>
                        <span style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>→</span>
                      </div>
                      <div className="field" style={{ flex: '1 1 180px' }}>
                        <label>Materie nouă (opțional)</label>
                        <input
                          type="text" value={newSchMaterieNoua}
                          onChange={e => setNewSchMaterieNoua(e.target.value)}
                          placeholder="ex: Fizică"
                        />
                      </div>
                    </div>
                    <div className="field" style={{ marginTop: 4 }}>
                      <label>Descriere (opțional)</label>
                      <textarea
                        value={newSchDesc}
                        onChange={e => setNewSchDesc(e.target.value)}
                        placeholder="Detalii suplimentare..."
                        rows={2}
                        style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: '0.95rem',
                          padding: '10px 14px', border: '2px solid var(--border)',
                          borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
                          color: 'var(--text)', width: '100%' }}
                      />
                    </div>
                    <button type="submit" className="btn-primary" disabled={schSaving} style={{ marginTop: 8 }}>
                      {schSaving ? 'Se adaugă...' : '+ Adaugă schimbare'}
                    </button>
                  </form>
                </div>

                <div className="controls" style={{ marginTop: 8 }}>
                  <h3 className="admin-section-title">
                    Schimbări adăugate
                    {!schimbariLoading && <span style={{ fontWeight: 400, marginLeft: 8 }}>({schimbari.length})</span>}
                  </h3>
                  {schimbariLoading ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Se încarcă...</div>
                  ) : schimbari.length === 0 ? (
                    <div className="empty-state">Nicio schimbare adăugată.</div>
                  ) : (
                    <div className="schimbari-list">
                      {schimbari.map(s => (
                        <div className="schimbare-card" key={s.id}>
                          <div className="schimbare-header">
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span className="schimbare-data">
                                {new Date(s.data + 'T12:00:00').toLocaleDateString('ro-RO', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                              <span className={`badge ${s.clasa === 'Toate clasele' ? 'badge--neutral' : 'badge--info'}`}>{s.clasa}</span>
                            </div>
                            <button className="btn-delete" onClick={() => deleteSchimbare(s.id)} title="Șterge">✕</button>
                          </div>
                          <div className="schimbare-titlu">{s.titlu}</div>
                          {(s.materieVeche || s.materieNoua) && (
                            <div className="schimbare-materii">
                              {s.materieVeche && <span className="badge badge--danger">{s.materieVeche}</span>}
                              {s.materieVeche && s.materieNoua && <span style={{ color: 'var(--text-muted)' }}>→</span>}
                              {s.materieNoua && <span className="badge badge--success">{s.materieNoua}</span>}
                            </div>
                          )}
                          {s.descriere && <div className="schimbare-desc">{s.descriere}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {/* ══ Tab: Audit ══ */}
        {tab === 'audit' && (
          <div>
            <div className="controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 className="admin-section-title" style={{ marginBottom: 4 }}>Jurnal de activitate</h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: 0 }}>
                  Ultimele 100 de acțiuni efectuate în panoul de administrare.
                </p>
              </div>
              <button className="btn-search" style={{ background: '#7c3aed' }} onClick={loadAuditLog} disabled={auditLoading}>
                ↻ Reîncarcă
              </button>
            </div>

            {auditLoading && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                Se încarcă jurnalul...
              </div>
            )}

            {!auditLoading && auditEntries.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
                Nicio acțiune înregistrată încă.
              </div>
            )}

            {!auditLoading && auditEntries.length > 0 && (
              <div className="attendance-table-wrap">
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th style={{ width: 160 }}>Data și ora</th>
                      <th style={{ width: 200 }}>Acțiune</th>
                      <th>Detalii</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEntries.map(entry => {
                      const meta = ACTION_META[entry.action] ?? { label: entry.action, icon: '•', color: '#6b7280' };
                      const date = entry.timestamp ? entry.timestamp.toDate() : null;
                      const dateStr = date
                        ? date.toLocaleString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '—';
                      const details = formatDetails(entry.details);
                      return (
                        <tr key={entry.id}>
                          <td className="td-ip" style={{ whiteSpace: 'nowrap' }}>{dateStr}</td>
                          <td>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 6,
                              fontWeight: 600, fontSize: '0.82rem', color: meta.color,
                            }}>
                              <span>{meta.icon}</span>
                              {meta.label}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                            {details || <em style={{ opacity: 0.5 }}>—</em>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
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
                <label>Parolă nouă <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(lasă gol pentru a păstra actuala)</span></label>
                <input
                  type="text"
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  placeholder="Introduceți doar dacă doriți să schimbați"
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
