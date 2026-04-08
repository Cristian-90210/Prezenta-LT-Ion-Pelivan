import { BrowserRouter, Routes, Route } from 'react-router-dom';
import StudentPage from './pages/StudentPage';
import TeacherPage from './pages/TeacherPage';
import './App.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StudentPage />} />
        <Route path="/teacher" element={<TeacherPage />} />
      </Routes>
    </BrowserRouter>
  );
}
