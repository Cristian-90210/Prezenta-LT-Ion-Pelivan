import { BrowserRouter, Routes, Route } from 'react-router-dom';
import TeacherPage from './pages/TeacherPage';
import AdminPage from './pages/AdminPage';
import AuthPage from './pages/AuthPage';
import StudentDashboardPage from './pages/StudentDashboardPage';
import { useAuth } from './hooks/useAuth';
import './App.css';

function StudentRouter() {
  const { user, loading } = useAuth();
  // Arată login imediat; dacă Firebase confirmă sesiunea, trece automat la dashboard
  if (loading || !user) return <AuthPage />;
  return <StudentDashboardPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StudentRouter />} />
        <Route path="/teacher" element={<TeacherPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  );
}
