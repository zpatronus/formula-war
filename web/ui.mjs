// All untrusted content interpolated into HTML must pass through this function.
// Other UI sinks use textContent or canvas.fillText, which do not interpret HTML.
export function escapeHTML(value) {
 return String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
 }[character]));
}
