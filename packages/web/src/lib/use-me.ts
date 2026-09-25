import { useCallback, useEffect, useState } from "react";
import type { Me } from "./types.js";

type State =
  | { status: "loading" }
  // `expired` is set when this browser had a session and it timed out,
  // so the login page can say so rather than looking as if nothing
  // happened.
  | { status: "signed-out"; expired: boolean }
  // The server couldn't be reached or failed. Not the same as signed
  // out: sending someone to a login page when the real problem is an
  // outage just has them signing in again and again.
  | { status: "unavailable" }
  | { status: "signed-in"; me: Me };

// One place that answers "who is this and what may they do", so pages
// don't each re-derive it. Gating UI on `me.permissions` hides controls
// the caller can't use; it is not the access check itself, which stays
// on the server.
export function useMe(): State & { retry: () => void } {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { credentials: "include" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.ok) {
          setState({ status: "signed-in", me: (await res.json()) as Me });
        } else if (res.status === 401) {
          const body = (await res.json().catch(() => null)) as { reason?: string } | null;
          setState({ status: "signed-out", expired: body?.reason === "session_expired" });
        } else {
          setState({ status: "unavailable" });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { ...state, retry };
}

export function can(me: Me | undefined, permission: string): boolean {
  return me?.permissions.includes(permission as Me["permissions"][number]) ?? false;
}
