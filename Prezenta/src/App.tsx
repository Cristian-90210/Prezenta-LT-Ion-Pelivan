import { BrowserRouter, Routes, Route } from 'react-router-dom';
import TeacherPage from './pages/TeacherPage';
import AdminPage from './pages/AdminPage';
import AuthPage from './pages/AuthPage';
import StudentDashboardPage from './pages/StudentDashboardPage';
import { useAuth } from './hooks/useAuth';
import './App.css';

function StudentRouter() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="page-center">
        <div style={{ color: 'var(--text-muted)', fontSize: '1rem' }}>Se încarcă...</div>
      </div>
    );
  }
  return user ? <StudentDashboardPage /> : <AuthPage />;
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
