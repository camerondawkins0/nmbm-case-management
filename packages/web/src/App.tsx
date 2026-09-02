import { Routes, Route } from "react-router-dom";
import LoginPage from "./pages/login-page.js";
import DashboardPage from "./pages/dashboard-page.js";
import FeedbackPage from "./pages/feedback-page.js";
import FeedbackAdminPage from "./pages/admin/feedback-admin-page.js";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/feedback" element={<FeedbackPage />} />
      <Route path="/admin/feedback" element={<FeedbackAdminPage />} />
    </Routes>
  );
}
