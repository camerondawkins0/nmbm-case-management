import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useMe } from "./lib/use-me.js";
import { AppShell } from "./components/app-shell.js";
import LoginPage from "./pages/login-page.js";
import DashboardPage from "./pages/dashboard-page.js";
import ParticipantsPage from "./pages/participants-page.js";
import ParticipantDetailPage from "./pages/participant-detail-page.js";
import CarePlanReviewPage from "./pages/care-plan-review-page.js";
import FeedbackPage from "./pages/feedback-page.js";
import FeedbackAdminPage from "./pages/admin/feedback-admin-page.js";

export default function App() {
  const session = useMe();
  const location = useLocation();

  if (session.status === "loading") {
    return <p className="p-6 text-sm text-nmbm-ink/50">Loading…</p>;
  }

  if (session.status === "signed-out") {
    // Everything behind the shell needs a session. The server enforces
    // this too — this only saves a round trip of 401s.
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
      </Routes>
    );
  }

  const { me } = session;

  return (
    <AppShell me={me}>
      <Routes>
        <Route path="/" element={<DashboardPage me={me} />} />
        <Route path="/participants" element={<ParticipantsPage />} />
        <Route path="/participants/:id" element={<ParticipantDetailPage me={me} />} />
        <Route path="/care-plans/review" element={<CarePlanReviewPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/admin/feedback" element={<FeedbackAdminPage />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
