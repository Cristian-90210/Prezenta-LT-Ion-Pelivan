import { useState, useEffect } from 'react';
import {
  collection, query, where, onSnapshot, deleteDoc, doc,
  getDocs, updateDoc, setDoc,
} from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { db } from '../firebase';
import type { AttendanceRecord } from '../types';
import { useConfig } from '../hooks/useConfig';
import { TEACHERS, type Teacher } from '../teachers';
import { useTeacherPhoto } from '../hooks/useProfilePhoto';
import CropModal from '../components/CropModal';

// ── Helpers sesiune profesor ───────────────────────────────────────────────────
function sessionIsValid(key: string): boolean {
  const t = sessionStorage.getItem(key);
  if (!t) return false;
  return 10 * 60 * 1000 - (Date.now() - Number(t)) > 0;
}

function getStoredTeacher(): Teacher | null {
  if (!sessionIsValid('teacherLoginTime')) return null;
  const id = sessionStorage.getItem('teacherId');
  if (!id) return null;
  // Încearcă întâi varianta serializată (poate conține date Firestore actualizate)
  const raw = sessionStorage.getItem('teacherObj');
  if (raw) {
    try { return JSON.parse(raw) as Teacher; } catch {}
  }
  return TEACHERS.find(t => t.id === id) ?? null;
}
import { exportXlsx } from '../utils/exportXlsx';

type View = 'login' | 'dashboard';
type DashTab = 'lista' | 'statistici' | 'raport' | 'istoric' | 'profil';

export default function TeacherPage() {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const [view, setView] = useState<View>(() =>
    getStoredTeacher() ? 'dashboard' : 'login'
  );
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [currentTeacher, setCurrentTeacher] = useState<Teacher | null>(getStoredTeacher);

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

  // ── Photo (must be before any conditional return — Rules of Hooks) ────────
  const { photoURL: teacherPhoto, saving: photoUploading, error: photoError, savePhoto } =
    useTeacherPhoto(currentTeacher?.id);
  const [cropFile, setCropFile] = useState<File | null>(null);

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
  const [rangeFilterClasa, setRangeFilterClasa] = useState('');
  const [rangeSortDir, setRangeSortDir] = useState<'asc' | 'desc'>('desc');

  // ── Sort lista zilnică ─────────────────────────────────────────────────────
  const [sortOra, setSortOra] = useState<'asc' | 'desc'>('asc');

  const { teachers, classes: ALL_CLASSES } = useConfig();
  const siteUrl = window.location.origin;

  // ── Dark mode effect ──────────────────────────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', String(darkMode));
  }, [darkMode]);

  // ── Auto-logout după 10 minute (persistent prin sessionStorage) ──────────
  useEffect(() => {
    if (view !== 'dashboard') return;
    const TIMEOUT = 10 * 60 * 1000;
    const stored = sessionStorage.getItem('teacherLoginTime');
    const loginTime = stored ? Number(stored) : Date.now();
    if (!stored) sessionStorage.setItem('teacherLoginTime', String(loginTime));

    const checkAndLogout = () => {
      if (Date.now() - loginTime >= TIMEOUT) handleLogout();
    };

    const remaining = TIMEOUT - (Date.now() - loginTime);
    if (remaining <= 0) { handleLogout(); return; }

    const timer = setTimeout(handleLogout, remaining);
    // Pe mobil, timer-ul e înghețat în background — verificăm când revine în prim plan
    document.addEventListener('visibilitychange', checkAndLogout);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', checkAndLogout);
    };
  }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

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
      sessionStorage.setItem('teacherLoginTime', String(Date.now()));
      sessionStorage.setItem('teacherId', teacher.id);
      sessionStorage.setItem('teacherObj', JSON.stringify(teacher));
      setCurrentTeacher(teacher);
      setView('dashboard');
      setLoginError('');
    } else {
      setLoginError('Parolă incorectă.');
    }
  }

  function handleLogout() {
    sessionStorage.removeItem('teacherLoginTime');
    sessionStorage.removeItem('teacherId');
    sessionStorage.removeItem('teacherObj');
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
      setIstoricRecords(data.filter(r => r.materie === currentTeacher.subject));
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

  // ── Excel exports ─────────────────────────────────────────────────────────

  function exportXlsxDaily() {
    const dateLong = new Date(selectedDate + 'T12:00:00').toLocaleDateString('ro-RO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    exportXlsx({
      filename: `prezenta-${selectedDate}${filterClasa ? '-' + filterClasa : ''}`,
      sheets: [{
        sheetName: 'Prezență',
        title: `Prezență — ${currentTeacher?.subject ?? ''}`,
        subtitle: [
          `Data: ${dateLong}`,
          ...(filterClasa ? [`Clasa: ${filterClasa}`] : []),
        ],
        columns: [
          { label: '#',       key: 'nr',      type: 'number', align: 'center', minWidth: 4  },
          { label: 'Prenume', key: 'prenume',  type: 'text'                                  },
          { label: 'Nume',    key: 'nume',     type: 'text'                                  },
          { label: 'Clasa',   key: 'clasa',    type: 'text',   align: 'center'               },
          { label: 'Ora',     key: 'ora',      type: 'time',   align: 'center', minWidth: 8  },
        ],
        data: filtered.map((r, i) => ({
          nr:      i + 1,
          prenume: r.prenume,
          nume:    r.nume,
          clasa:   r.clasa,
          ora:     r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
        })),
        totals: { label: 'Total prezenți', value: filtered.length },
      }],
    });
  }

  function exportIstoricXlsx() {
    exportXlsx({
      filename: `raport-elev-${istoricPrenume}-${istoricNume}`,
      sheets: [{
        sheetName: 'Raport Elev',
        title: 'Raport Elev – Toate materiile',
        subtitle: [`Elev: ${istoricPrenume} ${istoricNume}`],
        columns: [
          { label: '#',       key: 'nr',      type: 'number', align: 'center', minWidth: 4  },
          { label: 'Data',    key: 'data',     type: 'date',   align: 'center', minWidth: 12 },
          { label: 'Clasa',   key: 'clasa',    type: 'text',   align: 'center'               },
          { label: 'Materie', key: 'materie',  type: 'text'                                  },
          { label: 'Ora',     key: 'ora',      type: 'time',   align: 'center', minWidth: 8  },
        ],
        data: istoricRecords.map((r, i) => ({
          nr:      i + 1,
          data:    r.data,
          clasa:   r.clasa,
          materie: r.materie || '—',
          ora:     r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
        })),
        totals: { label: 'Total prezențe', value: istoricRecords.length },
      }],
    });
  }

  function exportRangeXlsx() {
    exportXlsx({
      filename: `raport-interval-${rangeFrom}-${rangeTo}`,
      sheets: [
        // Sheet 1 — frecvență per elev
        {
          sheetName: 'Frecvență Elevi',
          title: `Raport Interval — ${currentTeacher?.subject ?? ''}`,
          subtitle: [
            `Interval: ${rangeFrom} → ${rangeTo}`,
            `Total înregistrări: ${rangeRecords.length}  ·  Elevi unici: ${rangeByStudent.length}`,
          ],
          columns: [
            { label: '#',            key: 'nr',      type: 'number', align: 'center', minWidth: 4  },
            { label: 'Prenume',      key: 'prenume',  type: 'text'                                  },
            { label: 'Nume',         key: 'nume',     type: 'text'                                  },
            { label: 'Clasa',        key: 'clasa',    type: 'text',   align: 'center'               },
            { label: 'Zile prezent', key: 'count',    type: 'number', align: 'center', minWidth: 12 },
          ],
          data: rangeByStudent.map((s, i) => ({
            nr:      i + 1,
            prenume: s.prenume,
            nume:    s.nume,
            clasa:   s.clasa,
            count:   s.count,
          })),
          totals: { label: 'Total elevi', value: rangeByStudent.length },
        },
        // Sheet 2 — detaliu cronologic
        {
          sheetName: 'Detaliu Înregistrări',
          title: `Detaliu înregistrări — ${currentTeacher?.subject ?? ''}`,
          subtitle: [`Interval: ${rangeFrom} → ${rangeTo}`],
          columns: [
            { label: '#',       key: 'nr',      type: 'number', align: 'center', minWidth: 4  },
            { label: 'Prenume', key: 'prenume',  type: 'text'                                  },
            { label: 'Nume',    key: 'nume',     type: 'text'                                  },
            { label: 'Clasa',   key: 'clasa',    type: 'text',   align: 'center'               },
            { label: 'Data',    key: 'data',     type: 'date',   align: 'center', minWidth: 12 },
            { label: 'Ora',     key: 'ora',      type: 'time',   align: 'center', minWidth: 8  },
          ],
          data: [...rangeRecords]
            .sort((a, b) => b.data.localeCompare(a.data))
            .map((r, i) => ({
              nr:      i + 1,
              prenume: r.prenume,
              nume:    r.nume,
              clasa:   r.clasa,
              data:    r.data,
              ora:     r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
            })),
          totals: { label: 'Total înregistrări', value: rangeRecords.length },
        },
      ],
    });
  }

  // ── PDF helpers ───────────────────────────────────────────────────────────
  const PDF_INDIGO: [number, number, number] = [67, 56, 202];
  const PDF_INDIGO_LIGHT: [number, number, number] = [237, 233, 254];

  function pdfHeader(doc: jsPDF, subtitle: string) {
    // Banner gradient simulat cu un dreptunghi
    doc.setFillColor(...PDF_INDIGO);
    doc.rect(0, 0, 210, 36, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('Liceul Teoretic Ion Pelivan', 14, 13);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Ora de ${currentTeacher?.subject ?? ''}  ·  Prof. ${currentTeacher?.name ?? ''}`, 14, 22);
    doc.text(subtitle, 14, 30);
    doc.setTextColor(0, 0, 0);
  }

  function pdfFooter(doc: jsPDF) {
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(160, 160, 160);
      doc.text(
        `Generat la ${new Date().toLocaleString('ro-RO')}   |   Pagina ${i} din ${pages}`,
        14, doc.internal.pageSize.height - 8,
      );
    }
  }

  // PDF – Lista zilnică
  function exportPDF() {
    const dateLong = new Date(selectedDate + 'T12:00:00').toLocaleDateString('ro-RO', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
    const doc = new jsPDF();
    pdfHeader(doc, `Prezență — ${dateLong}`);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text(`Total prezenți: ${filtered.length}${filterClasa ? `  ·  Clasa: ${filterClasa}` : ''}`, 14, 46);

    autoTable(doc, {
      startY: 52,
      head: [['#', 'Prenume', 'Nume', 'Clasa', 'Ora înregistrării']],
      body: filtered.map((r, i) => [
        i + 1,
        r.prenume,
        r.nume,
        r.clasa,
        r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
      ]),
      headStyles: { fillColor: PDF_INDIGO, textColor: 255, fontStyle: 'bold', fontSize: 10 },
      alternateRowStyles: { fillColor: PDF_INDIGO_LIGHT },
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 4 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        3: { cellWidth: 28, halign: 'center' },
        4: { cellWidth: 38, halign: 'center' },
      },
    });

    pdfFooter(doc);
    doc.save(`prezenta-${selectedDate}${filterClasa ? '-' + filterClasa : ''}.pdf`);
  }

  // PDF – Raport interval
  function exportRangePDF() {
    const doc = new jsPDF();
    pdfHeader(doc, `Raport interval: ${rangeFrom} → ${rangeTo}`);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text(
      `${rangeRecords.length} înregistrări  ·  ${rangeByStudent.length} elevi unici`,
      14, 46,
    );

    // Secțiunea 1 — frecvență per elev
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_INDIGO);
    doc.text('Frecvență elevi', 14, 55);

    autoTable(doc, {
      startY: 59,
      head: [['#', 'Prenume', 'Nume', 'Clasa', 'Zile prezent']],
      body: rangeByStudent.map((s, i) => [i + 1, s.prenume, s.nume, s.clasa, s.count]),
      headStyles: { fillColor: PDF_INDIGO, textColor: 255, fontStyle: 'bold', fontSize: 10 },
      alternateRowStyles: { fillColor: PDF_INDIGO_LIGHT },
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 4 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        3: { cellWidth: 28, halign: 'center' },
        4: { cellWidth: 30, halign: 'center' },
      },
    });

    // Secțiunea 2 — detaliu cronologic
    const afterTable = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PDF_INDIGO);
    doc.text('Detaliu înregistrări', 14, afterTable);

    autoTable(doc, {
      startY: afterTable + 4,
      head: [['#', 'Prenume', 'Nume', 'Clasa', 'Data', 'Ora']],
      body: [...rangeRecords]
        .sort((a, b) => b.data.localeCompare(a.data))
        .map((r, i) => [
          i + 1, r.prenume, r.nume, r.clasa,
          new Date(r.data + 'T12:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
          r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
        ]),
      headStyles: { fillColor: PDF_INDIGO, textColor: 255, fontStyle: 'bold', fontSize: 10 },
      alternateRowStyles: { fillColor: PDF_INDIGO_LIGHT },
      styles: { font: 'helvetica', fontSize: 9, cellPadding: 3 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        3: { cellWidth: 22, halign: 'center' },
        4: { cellWidth: 28, halign: 'center' },
        5: { cellWidth: 20, halign: 'center' },
      },
    });

    pdfFooter(doc);
    doc.save(`raport-interval-${rangeFrom}-${rangeTo}.pdf`);
  }

  // PDF – Raport elev
  function exportIstoricPDF() {
    const doc = new jsPDF();
    pdfHeader(doc, `Raport elev — Toate materiile`);

    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text(`${istoricPrenume} ${istoricNume}`, 14, 46);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Total prezențe: ${istoricRecords.length}`, 14, 53);

    autoTable(doc, {
      startY: 60,
      head: [['#', 'Data', 'Clasa', 'Materie', 'Ora']],
      body: istoricRecords.map((r, i) => [
        i + 1,
        new Date(r.data + 'T12:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' }),
        r.clasa,
        r.materie ?? '—',
        r.timestamp.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' }),
      ]),
      headStyles: { fillColor: PDF_INDIGO, textColor: 255, fontStyle: 'bold', fontSize: 10 },
      alternateRowStyles: { fillColor: PDF_INDIGO_LIGHT },
      styles: { font: 'helvetica', fontSize: 10, cellPadding: 4 },
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 32, halign: 'center' },
        2: { cellWidth: 25, halign: 'center' },
        4: { cellWidth: 22, halign: 'center' },
      },
    });

    pdfFooter(doc);
    doc.save(`raport-elev-${istoricPrenume}-${istoricNume}.pdf`);
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const filtered = records
    .filter(r => {
      const matchesClasa = !filterClasa || r.clasa === filterClasa;
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        r.prenume.toLowerCase().includes(q) ||
        r.nume.toLowerCase().includes(q) ||
        `${r.prenume} ${r.nume}`.toLowerCase().includes(q);
      return matchesClasa && matchesSearch;
    })
    .sort((a, b) => sortOra === 'asc'
      ? a.timestamp.getTime() - b.timestamp.getTime()
      : b.timestamp.getTime() - a.timestamp.getTime()
    );

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
  )
  .filter(s => !rangeFilterClasa || s.clasa === rangeFilterClasa)
  .sort((a, b) => rangeSortDir === 'desc' ? b.count - a.count : a.count - b.count);

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
    { id: 'profil',     icon: '🧑', label: 'Profilul meu' },
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
          <button className="btn-hamburger" onClick={() => setSidebarOpen(true)} aria-label="Meniu">☰</button>
          <div className="header-center-title">
            <span className="hct-subject">{currentTeacher?.subject}</span>
            <span className="hct-school">LT Ion Pelivan</span>
          </div>
          <button
            className="header-profile-btn"
            onClick={() => setDashTab('profil')}
            title="Profilul meu"
            aria-label="Profilul meu"
          >
            {teacherPhoto
              ? <img src={teacherPhoto} alt="avatar" />
              : (currentTeacher?.name?.charAt(0).toUpperCase() ?? '👩')
            }
          </button>
        </div>
      </header>

      <div className="teacher-body">

        {/* ══ SIDEBAR PERMANENT (desktop) ══ */}
        <aside className="teacher-sidebar-fixed">
          <div className="tsf-profile">
            <div className="tsf-avatar">{currentTeacher?.name?.charAt(0).toUpperCase() ?? '👩'}</div>
            <div className="tsf-info">
              <span className="tsf-name">{currentTeacher?.name}</span>
              <span className="tsf-badge">Profesor</span>
            </div>
          </div>

          <nav className="tsf-nav">
            {TAB_ITEMS.map(item => (
              <button
                key={item.id}
                className={`tsf-nav-item${dashTab === item.id ? ' active' : ''}`}
                onClick={() => setDashTab(item.id)}
              >
                <span className="tsf-nav-icon">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>

          <div className="tsf-footer">
            <div className="sidebar-lock-row">
              <span className="sidebar-lock-label">
                {locked ? '🔒 Blocat' : '🔓 Activ'}
              </span>
              <button
                className={`sidebar-lock-btn${locked ? ' locked' : ''}`}
                onClick={handleToggleLock}
                disabled={lockLoading}
              >
                {locked ? 'Deschide' : 'Blochează'}
              </button>
            </div>
            <button
              className="tsf-action-btn"
              onClick={() => setQrVisible(v => !v)}
            >
              📱 {qrVisible ? 'Ascunde QR' : 'Afișează QR'}
            </button>
            <div className="sidebar-toggle-row">
              <span className="sidebar-toggle-label">🌙 Mod întunecat</span>
              <label className="toggle-switch">
                <input type="checkbox" checked={darkMode} onChange={() => setDarkMode(d => !d)} />
                <span className="toggle-slider" />
              </label>
            </div>
            <button className="sidebar-logout" onClick={handleLogout}>↩ Deconectare</button>
          </div>
        </aside>

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
                <div className="field">
                  <label>Sortare după Ora</label>
                  <select value={sortOra} onChange={e => setSortOra(e.target.value as 'asc' | 'desc')}>
                    <option value="asc">↑ Crescător</option>
                    <option value="desc">↓ Descrescător</option>
                  </select>
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
                    <button className="btn-action" onClick={exportXlsxDaily}>⬇ Excel</button>
                    <button className="btn-action btn-pdf no-print" onClick={exportPDF}>⬇ PDF</button>
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
                  <div className="field">
                    <label htmlFor="range-filter-clasa">Filtrează clasa</label>
                    <select id="range-filter-clasa" value={rangeFilterClasa} onChange={e => setRangeFilterClasa(e.target.value)}>
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
                      {rangeFilterClasa && ` — clasa ${rangeFilterClasa}`}
                    </span>
                    <button className="btn-action" onClick={exportRangeXlsx}>⬇ Excel</button>
                    <button className="btn-action btn-pdf" onClick={exportRangePDF}>⬇ PDF</button>
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
                          <th
                            style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
                            onClick={() => setRangeSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                            title="Click pentru a schimba ordinea"
                          >
                            Zile prezent {rangeSortDir === 'desc' ? '↓' : '↑'}
                          </th>
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
                        <button className="btn-action" onClick={exportIstoricXlsx}>⬇ Excel</button>
                        <button className="btn-action btn-pdf" onClick={exportIstoricPDF}>⬇ PDF</button>
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
                                ? <span className="badge badge--success">{r.materie}</span>
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

        {/* ══════════════ TAB: PROFILUL MEU ══════════════ */}
        {dashTab === 'profil' && (
          <div style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>

            {/* ── Poza de profil ── */}
            <div className="controls" style={{ marginBottom: 0 }}>
              <h3 className="admin-section-title">Poza de profil</h3>
              <div className="photo-upload-area">
                {teacherPhoto
                  ? <img src={teacherPhoto} alt="avatar" className="photo-preview" />
                  : <div className="photo-preview-placeholder">
                      {currentTeacher?.name?.charAt(0).toUpperCase() ?? '👩'}
                    </div>
                }
                <div className="photo-upload-info">
                  <label className="photo-upload-label">
                    {photoUploading ? 'Se încarcă...' : teacherPhoto ? 'Schimbă poza' : 'Adaugă poza'}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={photoUploading}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) setCropFile(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <span className="photo-upload-hint">JPG, PNG · ajustare circulară</span>
                  {photoError && <span style={{ color: 'var(--rose)', fontSize: '0.8rem' }}>{photoError}</span>}
                </div>
              </div>
            </div>

            {/* ── Info cont ── */}
            <div className="controls">
              <h3 className="admin-section-title">Informații</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Nume</span>
                  <span style={{ fontWeight: 700 }}>{currentTeacher?.name}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Materie</span>
                  <span style={{ fontWeight: 700, color: 'var(--indigo)' }}>{currentTeacher?.subject}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Rol</span>
                  <span className="badge">Profesor</span>
                </div>
              </div>
            </div>

          </div>
        )}

      </main>
      </div>

      {cropFile && (
        <CropModal
          file={cropFile}
          onConfirm={base64 => { savePhoto(base64); setCropFile(null); }}
          onCancel={() => setCropFile(null)}
        />
      )}
    </div>
  );
}
