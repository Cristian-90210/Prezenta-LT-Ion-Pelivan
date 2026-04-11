import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { TEACHERS, type Teacher } from '../teachers';

export const DEFAULT_CLASSES: string[] = [
  ...['V', 'VI', 'VII', 'VIII', 'IX'].flatMap(cls => ['A', 'B', 'C'].map(lit => `${cls}-${lit}`)),
  ...['X', 'XI', 'XII'].flatMap(cls => ['REAL', 'UMAN'].map(profil => `${cls}-${profil}`)),
];

export function useConfig() {
  const [teachers, setTeachers] = useState<Teacher[]>(TEACHERS);
  const [classes, setClasses] = useState<string[]>(DEFAULT_CLASSES);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'settings', 'config'),
      snap => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (Array.isArray(data.teachers) && data.teachers.length > 0) {
          setTeachers(data.teachers as Teacher[]);
        }
        if (Array.isArray(data.classes) && data.classes.length > 0) {
          setClasses(data.classes as string[]);
        }
      },
      () => {} // ignore errors, keep defaults
    );
    return () => unsub();
  }, []);

  return { teachers, classes };
}
