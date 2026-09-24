// offline/format.ts — display helpers for the offline UI (byte sizes only; duration/clock
// formatters live with their own views under views/*/format.ts).

/** Human-readable byte size, e.g. 734 kB, 1.2 GB. Base-1000 (matches how OSes/stores
 *  label download sizes), one decimal from MB up. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let u = 0;
  while (n >= 1000 && u < units.length - 1) { n /= 1000; u += 1; }
  const decimals = u >= 2 ? 1 : 0; // whole B/kB, one decimal MB+
  return `${n.toFixed(decimals)} ${units[u]}`;
}
