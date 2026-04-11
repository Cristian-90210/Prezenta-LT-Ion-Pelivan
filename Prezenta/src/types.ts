export interface AttendanceRecord {
  id: string;
  prenume: string;
  nume: string;
  clasa: string;
  timestamp: Date;
  data: string;
  ip?: string;
  materie?: string;
  email?: string;
}
