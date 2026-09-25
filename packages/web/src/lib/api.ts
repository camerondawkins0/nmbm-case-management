export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Every call is same-origin with the session cookie.
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  if (res.status === 401) {
    const method = (init?.method ?? "GET").toUpperCase();
    // The session ended while the page was open — idle timeout, a
    // sign-out in another tab. Loading something: go back through
    // sign-in and return here. Saving something: stay put. Navigating
    // away would throw out whatever the worker just typed, which is
    // usually a visit note they can't reconstruct.
    if (method === "GET") {
      const here = window.location.pathname + window.location.search;
      window.location.assign(`/login?session=ended&returnTo=${encodeURIComponent(here)}`);
    }
    throw new ApiError(
      401,
      "Your session has ended. Copy anything you've typed, then sign in again.",
    );
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      // The API sends the rule that was violated in `message` — showing
      // that to the worker is the whole point of the gates.
      if (body?.message) message = body.message;
    } catch {
      // Non-JSON error body; the status-based message stands.
    }
    throw new ApiError(res.status, message);
  }
  return res.json() as Promise<T>;
}
