// netlify/lib/html.js
// Escaping for values interpolated into server-rendered HTML.
//
// Registrant names and emails come from a public form, so anything echoed back
// into a page has to be escaped — otherwise a name like
// `<img src=x onerror=...>` executes on our own origin, where the admin
// dashboard keeps its session token.

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
