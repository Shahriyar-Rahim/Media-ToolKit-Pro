// Greeting from the computer's own clock (local time, not the server's).
export function greeting(d = new Date()) {
  const h = d.getHours();
  return h >= 5 && h < 12 ? 'Good morning' : h >= 12 && h < 17 ? 'Good afternoon' : h >= 17 && h < 22 ? 'Good evening' : 'Good night';
}
export const clockText = (d = new Date()) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
