import { useState, useEffect } from 'react';
import { doc, onSnapshot, updateDoc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { compressImage } from '../utils/compressImage';

// ── Hook pentru elevul Firebase Auth ─────────────────────────────────────────

export function useStudentPhoto(uid: string | undefined) {
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'students', uid), snap => {
      setPhotoURL(snap.data()?.photoURL ?? null);
    });
    return () => unsub();
  }, [uid]);

  async function uploadPhoto(file: File) {
    if (!uid) return;
    setError('');
    setUploading(true);
    try {
      const base64 = await compressImage(file);
      await updateDoc(doc(db, 'students', uid), { photoURL: base64 });
    } catch {
      setError('Eroare la încărcarea imaginii.');
    } finally {
      setUploading(false);
    }
  }

  return { photoURL, uploading, error, uploadPhoto };
}

// ── Hook pentru profesor (fără Firebase Auth) ─────────────────────────────────

export function useTeacherPhoto(teacherId: string | undefined) {
  const [photoURL, setPhotoURL] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!teacherId) return;
    const unsub = onSnapshot(doc(db, 'settings', 'teacherPhotos'), snap => {
      setPhotoURL(snap.exists() ? (snap.data()[teacherId] ?? null) : null);
    });
    return () => unsub();
  }, [teacherId]);

  async function uploadPhoto(file: File) {
    if (!teacherId) return;
    setError('');
    setUploading(true);
    try {
      const base64 = await compressImage(file);
      await setDoc(
        doc(db, 'settings', 'teacherPhotos'),
        { [teacherId]: base64 },
        { merge: true },
      );
    } catch {
      setError('Eroare la încărcarea imaginii.');
    } finally {
      setUploading(false);
    }
  }

  return { photoURL, uploading, error, uploadPhoto };
}

// ── Citire foto oricărui profesor (read-only, pt. a arăta în tabele) ──────────

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
