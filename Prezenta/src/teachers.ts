export interface Teacher {
  id: string;        // identificator URL-safe (fără diacritice)
  name: string;      // numele afișat
  subject: string;   // materia predată
  password: string;  // parola de logare
}

// ── Adaugă / modifică profesorii aici ──────────────────────────────────────
export const TEACHERS: Teacher[] = [
  { id: 'informatica', name: 'Prof. Informatică', subject: 'Informatică', password: 'info2024'    },
  { id: 'fizica',      name: 'Prof. Fizică',      subject: 'Fizică',      password: 'fizica2024'  },
  { id: 'matematica',  name: 'Prof. Matematică',  subject: 'Matematică',  password: 'mate2024'    },
  { id: 'chimie',      name: 'Prof. Chimie',       subject: 'Chimie',      password: 'chimie2024'  },
  { id: 'biologie',    name: 'Prof. Biologie',     subject: 'Biologie',    password: 'bio2024'     },
  { id: 'romana',      name: 'Prof. Română',       subject: 'Română',      password: 'romana2024'  },
  { id: 'engleza',     name: 'Prof. Engleză',      subject: 'Engleză',     password: 'engleza2024' },
];
