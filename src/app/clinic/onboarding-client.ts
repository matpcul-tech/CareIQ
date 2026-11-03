export function csrfHeader(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]).split(".")[0] : "";
}

/** Reads the token from the URL fragment, which browsers never send to the server, then clears it from the address bar. */
export function takeFragmentToken(): string {
  if (typeof window === "undefined") return "";
  const m = window.location.hash.match(/token=([A-Za-z0-9_-]+)/);
  if (m) window.history.replaceState(null, "", window.location.pathname);
  return m ? m[1] : "";
}

export async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrfHeader() },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
