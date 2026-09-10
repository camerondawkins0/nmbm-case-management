export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Every call is same-origin with the session cookie. A 401 means "not
// signed in" and is handled by the caller redirecting to /login rather
// than by throwing a generic failure.
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
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
