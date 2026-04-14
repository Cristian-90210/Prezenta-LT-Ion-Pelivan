# Prezență — Liceul Teoretic "Ion Pelivan"

A web application for **digital attendance tracking**, built with React, TypeScript, and Firebase Firestore. Teachers generate unique QR codes that students scan to mark their attendance in real time.

---

## Features

### For students
- **QR code check-in** — students scan the QR code displayed by the teacher and fill in a simple form (first name, last name, class)
- **Class-pre-filled QR** — the teacher can generate a separate QR for each class, so the class field is filled in automatically
- **Anti-duplicate protection** — a student cannot mark attendance twice on the same day for the same subject
- **Dark mode** — light/dark interface toggle

### For teachers 
- **Per-teacher password login** — each teacher/subject has its own password
- **Real-time attendance list** — updates instantly as students scan the QR code
- **Filter and search** — by class, date, or student name
- **Lock attendance** — the teacher can close the session with one click; students see a locked message
- **General or per-class QR code** — generate and display QR codes directly in the dashboard; clicking any QR enlarges it for the projector
- **CSV export** — download the attendance list for any day with a detailed header
- **Print** — print the current list directly from the browser

### Statistics and reports
- **Statistics tab** — visual bar chart of students present per class for the selected day; cards showing total, represented classes, and the class with the most attendees
- **Interval report** — enter a date range and get each student's frequency in that period, plus a day-by-day breakdown; CSV export with two sections (frequency + detail)
- **Student report** — search a student by name and see all their attendances across **all subjects**, grouped with per-subject summary cards and a full chronological table; CSV export

### Admin panel 
- **Teacher management** — add or delete teachers directly from the UI without touching the code; changes propagate live to all open pages
- **Class management** — add or delete classes (including custom ones like `IX-D`, `X-INFO`); live propagation
- **Change admin password** — password stored in Firestore, not in the source code
- **Reset to defaults** — one click to restore the predefined teacher/class list

### PWA — Installable as an app
- Can be installed on mobile or desktop directly from the browser (Chrome / Edge / Safari)
- Runs like a native app — no address bar, icon on the home screen
- Service worker with static asset caching; Firebase always requires an internet connection

---

## Tech stack

| Technology | Role |
|---|---|
| React 19 + TypeScript | UI and frontend logic |
| Firebase Firestore | Real-time database |
| Vite 8 | Build tool |
| React Router v7 | Client-side routing |
| qrcode.react | QR code generation |
| PWA (manifest + service worker) | Installability |

---

## Project structure

```
src/
├── pages/
│   ├── StudentPage.tsx   # Student check-in page
│   ├── TeacherPage.tsx   # Teacher dashboard
│   └── AdminPage.tsx     # Admin panel
├── hooks/
│   └── useConfig.ts      # Firestore hook: dynamic teachers and classes
├── firebase.ts           # Firebase configuration
├── teachers.ts           # Default teacher list (fallback)
└── types.ts              # TypeScript types

public/
├── manifest.webmanifest  # PWA config
├── sw.js                 # Service worker
└── icon.svg              # App icon
```

---

## How it works

1. The **administrator** goes to `/admin`, adds the school's teachers and classes
2. The **teacher** goes to `/teacher`, logs in with their password and opens the session
3. The **teacher** displays the QR code on the projector (general or per-class)
4. **Students** scan the QR with their phone, enter their name and press "Mark Attendance"
5. The **teacher** sees the list update in real time and can export or print at the end

---

## Data and security

- Each record stores: first name, last name, class, date, exact time, IP address, and subject
- The Firestore document ID is deterministic (`firstname|lastname|class|date|subject`), guaranteeing uniqueness without a database index
- Teachers see only their own subject's data in the daily list; the student report is available to all authenticated teachers
