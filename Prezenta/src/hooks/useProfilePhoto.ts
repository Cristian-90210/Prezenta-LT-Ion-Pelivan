import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

// ── Hook pentru elevul Firebase Auth ─────────────────────────────────────────

export function useStudentPhoto(uid: string | undefined) {
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'students', uid), snap => {
      setPhotoURL(snap.data()?.photoURL ?? null);
    });
    return () => unsub();
  }, [uid]);

  async function savePhoto(base64: string): Promise<boolean> {
    if (!uid) return false;
    setError('');
    setSaving(true);
    try {
      await updateDoc(doc(db, 'students', uid), { photoURL: base64 });
      return true;
    } catch (err: any) {
      console.error('[useStudentPhoto] savePhoto error:', err?.code, err?.message);
      setError(`Eroare la salvare: ${err?.code ?? err?.message ?? 'necunoscută'}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { photoURL, saving, error, savePhoto };
}

// ── Hook pentru profesor (fără Firebase Auth) ─────────────────────────────────

export function useTeacherPhoto(teacherId: string | undefined) {
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (!teacherId) return;
    const unsub = onSnapshot(doc(db, 'settings', 'teacherPhotos'), snap => {
      setPhotoURL(snap.exists() ? (snap.data()[teacherId] ?? null) : null);
    });
    return () => unsub();
  }, [teacherId]);

  async function savePhoto(base64: string): Promise<boolean> {
    if (!teacherId) return false;
    setError('');
    setSaving(true);
    try {
      await setDoc(
        doc(db, 'settings', 'teacherPhotos'),
        { [teacherId]: base64 },
        { merge: true },
      );
      return true;
    } catch (err: any) {
      console.error('[useTeacherPhoto] savePhoto error:', err?.code, err?.message);
      setError(`Eroare la salvare: ${err?.code ?? err?.message ?? 'necunoscută'}`);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { photoURL, saving, error, savePhoto };
}

// ── Citire foto oricărui profesor (read-only) ─────────────────────────────────

export function useTeacherPhotoById(teacherId: string | undefined) {
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  useEffect(() => {
    if (!teacherId) return;
    const unsub = onSnapshot(doc(db, 'settings', 'teacherPhotos'), snap => {
      setPhotoURL(snap.exists() ? (snap.data()[teacherId] ?? null) : null);
    });
    return () => unsub();
  }, [teacherId]);
  return photoURL;
}
