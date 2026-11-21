export function sanitizeDiagnostic(value, env = {}) {
  let safe = String(value);
  for (const [name, secret] of Object.entries(env)) {
    if (/(?:key|token|secret|password)/i.test(name) && typeof secret === "string" && secret.length >= 4) {
      safe = safe.split(secret).join("[REDACTED]");
    }
  }
  safe = safe
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|access[_-]?token|authorization|secret)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return safe.slice(-1200) || "No safe diagnostic detail available";
}
