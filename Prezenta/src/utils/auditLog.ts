import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export type AuditAction =
  | 'add_teacher'
  | 'delete_teacher'
  | 'edit_teacher'
  | 'add_class'
  | 'delete_class'
  | 'delete_student'
  | 'reset_password'
  | 'change_admin_password';

export async function logAudit(action: AuditAction, details: Record<string, string> = {}) {
  try {
    await addDoc(collection(db, 'audit_log'), {
      timestamp: serverTimestamp(),
      actor: 'admin',
      action,
      details,
    });
  } catch {
    // Nu blocăm operația principală dacă audit log-ul eșuează
  }
}
