  Aplicație web pentru înregistrarea digitală a prezenței elevilor, construită cu React, TypeScript și Firebase Firestore. Profesorii generează coduri QR unice pe care elevii le scanează pentru a-și marca prezența în timp real. 
                                                                                                                                                                                                                                    
  ---                                                                                                                                                                                                                               
  Funcționalități                                                                                                                                                                                                                   
                                         
  Pentru elevi

  - Înregistrare prin QR code — elevul scanează codul QR afișat de profesor și completează un formular simplu (prenume, nume, clasă)
  - QR pre-completat pe clasă — profesorul poate genera câte un QR separat pentru fiecare clasă, astfel clasa se completează automat
  - Protecție anti-duplicat — un elev nu poate marca prezența de două ori în aceeași zi la aceeași materie
  - Mod întunecat — interfață adaptabilă light/dark

  Pentru profesori (/teacher)

  - Autentificare cu parolă per profesor/materie
  - Listă prezențe în timp real — se actualizează instant când un elev scanează QR-ul
  - Filtrare și căutare — după clasă, dată sau numele elevului
  - Blocare înregistrare — profesorul poate închide sesiunea de prezență cu un singur click; elevii văd un mesaj de blocare
  - QR Code general sau per clasă — generare și afișare QR direct în dashboard; click pe orice QR îl mărește pentru proiector
  - Export CSV — descarcă lista de prezențe pentru orice zi, cu antet detaliat
  - Print — imprimă lista curentă direct din browser

  Statistici și rapoarte

  - Tab Statistici — grafic vizual cu numărul de elevi prezenți per clasă pentru ziua selectată; carduri cu total, clase reprezentate, clasa cu cei mai mulți elevi
  - Raport interval — introduce o perioadă (de la → până la) și obții frecvența fiecărui elev în acel interval, plus detaliu pe zile; export CSV cu două secțiuni (frecvență + detaliu)
  - Raport elev — caută un elev după nume și obții toate prezențele lui la toate materiile, grupate cu carduri per materie și tabel cronologic complet; export CSV

  Admin panel (/admin)

  - Gestionare profesori — adaugă sau șterge profesori direct din UI, fără a modifica codul; modificările se propagă live în toate paginile deschise
  - Gestionare clase — adaugă sau șterge clase (inclusiv clase personalizate gen IX-D, X-INFO); se propagă live
  - Schimbare parolă admin — parolă stocată în Firestore, nu în cod
  - Reset la valori implicite — un click pentru a reveni la lista de profesori/clase predefinite

  PWA — Instalabil ca aplicație

  - Poate fi instalat pe telefon sau desktop direct din browser (Chrome/Edge/Safari)
  - Funcționează ca aplicație nativă (fără bara de adresă, iconița pe ecranul principal)
  - Service worker cu cache pentru assets statice; Firebase funcționează întotdeauna online

  ---
  Tehnologii folosite

  ┌─────────────────────────────────┬───────────────────────────┐
  │           Tehnologie            │            Rol            │
  ├─────────────────────────────────┼───────────────────────────┤
  │ React 19 + TypeScript           │ UI și logică frontend     │
  ├─────────────────────────────────┼───────────────────────────┤
  │ Firebase Firestore              │ Bază de date în timp real │
  ├─────────────────────────────────┼───────────────────────────┤
  │ Vite 8                          │ Build tool                │
  ├─────────────────────────────────┼───────────────────────────┤
  │ React Router v7                 │ Navigare între pagini     │
  ├─────────────────────────────────┼───────────────────────────┤
  │ qrcode.react                    │ Generare QR code          │
  ├─────────────────────────────────┼───────────────────────────┤
  │ PWA (manifest + service worker) │ Instalabilitate           │
  └─────────────────────────────────┴───────────────────────────┘

  ---
  Structura proiectului

  src/
  ├── pages/
  │   ├── StudentPage.tsx   # Pagina de înregistrare pentru elevi
  │   ├── TeacherPage.tsx   # Dashboard profesor
  │   └── AdminPage.tsx     # Panou administrator
  ├── hooks/
  │   └── useConfig.ts      # Hook Firestore: profesori și clase dinamice
  ├── firebase.ts           # Configurare Firebase
  ├── teachers.ts           # Lista implicită de profesori (fallback)
  └── types.ts              # Tipuri TypeScript

  public/
  ├── manifest.webmanifest  # Config PWA
  ├── sw.js                 # Service worker
  └── icon.svg              # Iconița aplicației

  ---
  Cum funcționează

  1. Administratorul accesează /admin, adaugă profesorii și clasele școlii
  2. Profesorul accesează /teacher, se autentifică cu parola sa și deschide sesiunea
  3. Profesorul afișează QR-ul pe proiector (general sau per clasă)
  4. Elevii scanează QR-ul cu telefonul, completează numele și apasă „Marchează Prezența"
  5. Profesorul vede lista actualizată în timp real și poate exporta/printa la final

  ---
  Securitate și date

  - Fiecare înregistrare stochează: prenume, nume, clasă, dată, oră exactă, IP și materie
  - ID-ul documentului Firestore este determinist (prenume|nume|clasă|dată|materie), garantând unicitatea fără index de bază de date
  - Profesorii văd doar datele propriei materii în lista zilnică; raportul per elev este disponibil tuturor profesorilor autentificați
