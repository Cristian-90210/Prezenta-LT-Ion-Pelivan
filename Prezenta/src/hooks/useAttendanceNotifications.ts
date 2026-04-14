import { useEffect, useRef } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import type { Teacher } from '../teachers';

export function useAttendanceNotifications(
  teachers: Teacher[],
  permission: NotificationPermission,
) {
  const prevLockRef = useRef<Record<string, boolean> | null>(null);

  useEffect(() => {
    if (!('Notification' in window)) return;
    if (permission !== 'granted') return;
    if (teachers.length === 0) return;

    const unsub = onSnapshot(doc(db, 'settings', 'lock'), snap => {
      const current: Record<string, boolean> = snap.exists()
        ? (snap.data() as Record<string, boolean>)
        : {};

      const prev = prevLockRef.current;

      if (prev !== null) {
        const allIds = new Set([...Object.keys(current), ...Object.keys(prev)]);
        for (const id of allIds) {
          const wasLocked = prev[id] ?? false;
          const isLocked  = current[id] ?? false;
          if (wasLocked === isLocked) continue;

          const subject = teachers.find(t => t.id === id)?.subject ?? id;

          if (!isLocked) {
            new Notification('Prezență deschisă 📋', {
              body: `${subject} — poți marca prezența acum!`,
              icon: '/icon.svg',
              tag:  `lock-${id}`,
            });
          } else {
            new Notification('Prezență închisă 🔒', {
              body: `${subject} — înregistrarea a fost oprită.`,
              icon: '/icon.svg',
              tag:  `lock-${id}`,
            });
          }
        }
      }

      prevLockRef.current = current;
    });

    return () => unsub();
  }, [teachers, permission]);
}
