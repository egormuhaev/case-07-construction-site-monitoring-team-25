import { Route, Routes } from 'react-router-dom';
import AppLayout from './layout/AppLayout';
import ProjectsPage from './pages/ProjectsPage';
import ProjectPage from './pages/ProjectPage';
import PlanPage from './pages/PlanPage';
import DaysPage from './pages/DaysPage';
import DayPage from './pages/DayPage';
import ReportPage from './pages/ReportPage';
import AnalysisPage from './pages/AnalysisPage';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<ProjectPage />} />
        <Route path="/projects/:projectId/plan" element={<PlanPage />} />
        <Route path="/projects/:projectId/days" element={<DaysPage />} />
        <Route path="/projects/:projectId/days/:day" element={<DayPage />} />
        <Route
          path="/projects/:projectId/days/:day/report/:runId"
          element={<ReportPage />}
        />
        <Route path="/projects/:projectId/analysis" element={<AnalysisPage />} />
      </Route>
    </Routes>
  );
}
