/** IPv4 and IPv6 addresses and CIDR ranges as numbers, to match an address against published cloud ranges. */
import { isIPv4, isIPv6 } from 'node:net';

function v4(ip: string): bigint {
  return ip.split('.').reduce((n, part) => (n << 8n) + BigInt(Number(part)), 0n);
}

function v6(ip: string): bigint {
  // Expand "::" and an embedded IPv4 tail.
  let s = ip.toLowerCase();
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const n = v4(tail[1]!);
    s = s.slice(0, -tail[1]!.length) + `${((n >> 16n) & 0xffffn).toString(16)}:${(n & 0xffffn).toString(16)}`;
  }
  const [head, rest] = s.split('::');
  const h = head ? head.split(':') : [];
  const r = rest !== undefined ? (rest ? rest.split(':') : []) : [];
  const parts = rest !== undefined ? [...h, ...Array(8 - h.length - r.length).fill('0'), ...r] : h;
  return parts.reduce((n, part) => (n << 16n) + BigInt(parseInt(part || '0', 16)), 0n);
}

export interface Range {
  family: 4 | 6;
  start: bigint;
  end: bigint;
}

export function parseCidr(cidr: string): Range | null {
  const [addr, bitsText] = cidr.split('/');
  if (!addr || bitsText === undefined) return null;
  const bits = Number(bitsText);
  if (isIPv4(addr)) {
    const host = 32n - BigInt(bits);
    const start = (v4(addr) >> host) << host;
    return { family: 4, start, end: start + (1n << host) - 1n };
  }
  if (isIPv6(addr)) {
    const host = 128n - BigInt(bits);
    const start = (v6(addr) >> host) << host;
    return { family: 6, start, end: start + (1n << host) - 1n };
  }
  return null;
}

export function ipValue(ip: string): { family: 4 | 6; value: bigint } | null {
  if (isIPv4(ip)) return { family: 4, value: v4(ip) };
  if (isIPv6(ip)) return { family: 6, value: v6(ip) };
  return null;
}

/** The most specific range containing the address (longest prefix wins, as routing does). */
export function bestMatch<T extends { range: Range }>(ip: string, ranges: T[]): T | null {
  const v = ipValue(ip);
  if (!v) return null;
  let best: T | null = null;
  for (const r of ranges) {
    if (r.range.family !== v.family || v.value < r.range.start || v.value > r.range.end) continue;
    if (!best || r.range.end - r.range.start < best.range.end - best.range.start) best = r;
  }
  return best;
}
