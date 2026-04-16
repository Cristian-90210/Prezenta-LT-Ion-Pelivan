export interface OraDeClasa {
  id: string;
  zi: string;       // 'Luni' | 'Marți' | 'Miercuri' | 'Joi' | 'Vineri'
  ora: number;      // 1–8
  materie: string;
  profesor: string;
  cabinet: string;
}

export interface Schimbare {
  id: string;
  data: string;     // 'YYYY-MM-DD'
  clasa: string;    // class name or 'Toate clasele'
  titlu: string;
  descriere: string;
  creatLa: Date;
}

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
