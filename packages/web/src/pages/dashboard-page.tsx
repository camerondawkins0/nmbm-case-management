import { BrandMark } from "../components/brand-mark.js";
import { PARTICIPANT_LABEL_PLURAL } from "@nmbm/shared";

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-nmbm-paper">
      <header className="flex items-center gap-3 border-b border-nmbm-ink/10 px-6 py-4">
        <BrandMark size={36} />
        <span className="font-semibold tracking-wide text-nmbm-ink">NMBM Case Management</span>
      </header>
      <main className="px-6 py-8">
        <h1 className="text-xl font-semibold text-nmbm-ink">{PARTICIPANT_LABEL_PLURAL}</h1>
        <p className="mt-2 text-sm text-nmbm-ink/60">
          Scaffold placeholder — wire this up to <code>GET /api/participants</code> once
          auth is configured end to end.
        </p>
      </main>
    </div>
  );
}
