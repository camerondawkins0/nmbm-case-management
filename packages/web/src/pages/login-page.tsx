import { BrandMark } from "../components/brand-mark.js";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-nmbm-paper px-4">
      <BrandMark size={72} />
      <div className="text-center">
        <h1 className="text-2xl font-semibold tracking-wide text-nmbm-ink">NMBM</h1>
        <p className="mt-1 text-xs uppercase tracking-[0.2em] text-nmbm-gold">
          Make Your Next Move Your Best Move
        </p>
      </div>
      <a
        href="/auth/google/login"
        className="rounded border border-nmbm-ink px-6 py-2 text-sm font-medium text-nmbm-ink transition hover:bg-nmbm-ink hover:text-nmbm-paper"
      >
        Sign in with Google Workspace
      </a>
    </div>
  );
}
