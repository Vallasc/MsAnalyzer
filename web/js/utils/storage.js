// ── localStorage helpers ────────────────────────────────────────────────────
export function lsGet(k, fallback) {
  try { const v = localStorage.getItem(k); return v !== null ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
export function lsSave(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
