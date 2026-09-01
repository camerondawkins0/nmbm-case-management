import { Routes, Route } from "react-router-dom";
import LoginPage from "./pages/login-page.js";
import DashboardPage from "./pages/dashboard-page.js";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<DashboardPage />} />
      <Route path="/login" element={<LoginPage />} />
    </Routes>
  );
}
