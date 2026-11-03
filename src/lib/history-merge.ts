/**
 * Merge a health history save into the saved record.
 *
 * The step 3 form opens blank, so a save that only fills activity or sleep sends an
 * empty diet (MEPA) object. A shallow merge used to replace the saved diet answers
 * with that empty object, which made the app ask for diet again. Blank fields now
 * keep the saved answers; only fields the person actually entered are replaced.
 */
export function mergeHealthHistory(
  prior: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...prior };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "le8" || key === "clearLe8") continue;
    if (value === undefined) continue;
    next[key] = value;
  }
  const priorLe8 = isObject(prior.le8) ? prior.le8 : {};
  if (isObject(incoming.le8)) {
    const le8: Record<string, unknown> = { ...priorLe8 };
    for (const [key, value] of Object.entries(incoming.le8)) {
      if (value === undefined) continue;
      if (key === "mepa") {
        const priorMepa = isObject(priorLe8.mepa) ? priorLe8.mepa : {};
        const mepa: Record<string, unknown> = { ...priorMepa };
        if (isObject(value)) {
          for (const [k, v] of Object.entries(value)) if (v !== undefined) mepa[k] = v;
        }
        le8.mepa = mepa;
        continue;
      }
      le8[key] = value;
    }
    next.le8 = le8;
  }
  // Explicit removals only. Each entry names one saved answer the person removed.
  if (Array.isArray(incoming.clearLe8) && isObject(next.le8)) {
    const le8 = { ...next.le8 };
    const mepa = isObject(le8.mepa) ? { ...le8.mepa } : null;
    for (const key of incoming.clearLe8) {
      if (typeof key !== "string") continue;
      if (key.startsWith("mepa.")) { if (mepa) delete mepa[key.slice(5)]; }
      else delete le8[key];
    }
    if (mepa) le8.mepa = mepa;
    next.le8 = le8;
  }
  return next;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
