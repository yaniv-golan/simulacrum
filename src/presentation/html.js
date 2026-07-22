/** Escapes untrusted text for interpolation into presentation-owned HTML. */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Formats a KeyboardEvent code for compact controller hints. */
export const formatKeyCode = (code) =>
  code ? code.replace(/^(?:Key|Digit|Arrow)/, "") : "UNBOUND";
