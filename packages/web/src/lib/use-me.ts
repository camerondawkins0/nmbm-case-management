import { useEffect, useState } from "react";
import { api, ApiError } from "./api.js";
import type { Me } from "./types.js";

type State = { status: "loading" } | { status: "signed-out" } | { status: "signed-in"; me: Me };

// One place that answers "who is this and what may they do", so pages
// don't each re-derive it. Gating UI on `me.permissions` hides controls
// the caller can't use; it is not the access check itself, which stays
// on the server.
export function useMe(): State {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    api<Me>("/api/me")
      .then((me) => {
        if (!cancelled) setState({ status: "signed-in", me });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setState({ status: "signed-out" });
        } else {
          setState({ status: "signed-out" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

export function can(me: Me | undefined, permission: string): boolean {
  return me?.permissions.includes(permission as Me["permissions"][number]) ?? false;
}
