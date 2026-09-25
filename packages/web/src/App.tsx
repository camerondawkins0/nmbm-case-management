import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useMe } from "./lib/use-me.js";
import { AppShell } from "./components/app-shell.js";
import LoginPage from "./pages/login-page.js";
import { AwaitingAccessPage, ServerUnavailablePage } from "./pages/holding-pages.js";
import DashboardPage from "./pages/dashboard-page.js";
import ParticipantsPage from "./pages/participants-page.js";
import ParticipantDetailPage from "./pages/participant-detail-page.js";
import CarePlanReviewPage from "./pages/care-plan-review-page.js";
import NoteReviewPage from "./pages/note-review-page.js";
import IntakePage from "./pages/intake-page.js";
import AdminUsersPage from "./pages/admin/users-page.js";
import ProgramsPage from "./pages/programs-page.js";
import CohortPage from "./pages/cohort-page.js";
import ParticipationRecordPage from "./pages/participation-record-page.js";
import FeedbackPage from "./pages/feedback-page.js";
import FeedbackAdminPage from "./pages/admin/feedback-admin-page.js";
import SettingsPage from "./pages/admin/settings-page.js";
import FollowUpsPage from "./pages/follow-ups-page.js";

export default function App() {
  const session = useMe();
  const location = useLocation();

  if (session.status === "loading") {
    return <p className="p-6 text-sm text-nmbm-ink/50">Loading…</p>;
  }

  if (session.status === "unavailable") {
    return <ServerUnavailablePage onRetry={session.retry} />;
  }

  if (session.status === "signed-out") {
    // Everything behind the shell needs a session. The server enforces
    // this too — this only saves a round trip of 401s.
    return (
      <Routes>
        <Route path="/login" element={<LoginPage expired={session.expired} />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location }} />} />
      </Routes>
    );
  }

  const { me } = session;

  // Signed in, but nobody has assigned a role: no permission to open
  // anything, so there's no app to show — only what to do about it.
  if (me.roles.length === 0) {
    return <AwaitingAccessPage me={me} />;
  }

  return (
    <AppShell me={me}>
      <Routes>
        <Route path="/" element={<DashboardPage me={me} />} />
        <Route
          path="/participants"
          element={
            <ParticipantsPage
              canAdmit={me.permissions.includes("participants.write")}
              seesAllClosed={
                me.permissions.includes("participants.read.all") ||
                me.permissions.includes("participants.read.closed")
              }
            />
          }
        />
        <Route path="/participants/new" element={<IntakePage />} />
        <Route path="/participants/:id" element={<ParticipantDetailPage me={me} />} />
        <Route path="/care-plans/review" element={<CarePlanReviewPage />} />
        <Route path="/notes/review" element={<NoteReviewPage />} />
        <Route path="/programs" element={<ProgramsPage />} />
        <Route path="/cohorts/:id" element={<CohortPage me={me} />} />
        <Route path="/enrollments/:id/participation" element={<ParticipationRecordPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/admin/feedback" element={<FeedbackAdminPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
        <Route path="/follow-ups" element={<FollowUpsPage me={me} />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
