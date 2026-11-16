/**
 * Where a website and its email are served from — no account needed, so anyone can check a vendor. Each address is
 * matched against the ranges AWS and Google Cloud publish (region-level), the CDNs' published ranges (worldwide edges),
 * and otherwise the network's registered country (RDAP). This shows where a service is SERVED from, not where its
 * databases or backups are: ask the vendor for those (see the README's questions).
 */
import { bestMatch, parseCidr, type Range } from './cidr.ts';
import { countryOf } from './regions.ts';
import type { Finding } from './report.ts';

export interface Net {
  resolve4(host: string): Promise<string[]>;
  resolve6(host: string): Promise<string[]>;
  resolveCname(host: string): Promise<string[]>;
  resolveMx(host: string): Promise<{ exchange: string; priority: number }[]>;
  json(url: string): Promise<unknown>;
  text(url: string): Promise<string>;
}

interface Known {
  range: Range;
  provider: string;
  region: string | null;
  country: string | null;
  edge: boolean;
}

export const SOURCES = {
  aws: 'https://ip-ranges.amazonaws.com/ip-ranges.json',
  gcp: 'https://www.gstatic.com/ipranges/cloud.json',
  cloudflare4: 'https://www.cloudflare.com/ips-v4',
  cloudflare6: 'https://www.cloudflare.com/ips-v6',
  fastly: 'https://api.fastly.com/public-ip-list',
  rdap: (ip: string) => `https://rdap.org/ip/${encodeURIComponent(ip)}`,
};

const quiet = async <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

/** The published ranges, once per run. A source that can't be fetched is skipped (its addresses fall back to RDAP). */
export async function loadRanges(net: Net): Promise<Known[]> {
  const out: Known[] = [];
  const add = (cidr: string, k: Omit<Known, 'range'>) => {
    const range = parseCidr(cidr);
    if (range) out.push({ range, ...k });
  };
  const aws = (await quiet(net.json(SOURCES.aws), null)) as { prefixes?: { ip_prefix: string; region: string; service: string }[]; ipv6_prefixes?: { ipv6_prefix: string; region: string; service: string }[] } | null;
  for (const p of [...(aws?.prefixes ?? []).map((x) => ({ cidr: x.ip_prefix, ...x })), ...(aws?.ipv6_prefixes ?? []).map((x) => ({ cidr: x.ipv6_prefix, ...x }))]) {
    const edge = p.service === 'CLOUDFRONT' || p.service === 'GLOBALACCELERATOR' || p.region === 'GLOBAL';
    add(p.cidr, { provider: edge ? 'AWS CloudFront' : 'AWS', region: edge ? null : p.region, country: edge ? null : countryOf('aws', p.region), edge });
  }
  const gcp = (await quiet(net.json(SOURCES.gcp), null)) as { prefixes?: { ipv4Prefix?: string; ipv6Prefix?: string; scope: string }[] } | null;
  for (const p of gcp?.prefixes ?? []) {
    const cidr = p.ipv4Prefix ?? p.ipv6Prefix;
    if (cidr) add(cidr, { provider: 'Google Cloud', region: p.scope, country: countryOf('gcp', p.scope), edge: p.scope === 'global' });
  }
  const cf = [await quiet(net.text(SOURCES.cloudflare4), ''), await quiet(net.text(SOURCES.cloudflare6), '')].join('\n');
  for (const line of cf.split(/\s+/).filter(Boolean)) add(line, { provider: 'Cloudflare', region: null, country: null, edge: true });
  const fastly = (await quiet(net.json(SOURCES.fastly), null)) as { addresses?: string[]; ipv6_addresses?: string[] } | null;
  for (const c of [...(fastly?.addresses ?? []), ...(fastly?.ipv6_addresses ?? [])]) add(c, { provider: 'Fastly', region: null, country: null, edge: true });
  return out;
}

/** Well-known mail hosts, for a readable provider name. */
function mailProvider(host: string): string | null {
  const h = host.toLowerCase().replace(/\.$/, '');
  const ses = h.match(/inbound-smtp\.([a-z0-9-]+)\.amazonaws\.com$/);
  if (ses) return `Amazon SES (${ses[1]})`;
  if (/(^|\.)(google\.com|googlemail\.com)$/.test(h)) return 'Google Workspace';
  if (/(^|\.)(outlook\.com|protection\.outlook\.com)$/.test(h)) return 'Microsoft 365';
  if (/(^|\.)zoho\.(com|eu|in|com\.au|ca)$/.test(h)) return 'Zoho Mail';
  if (/(^|\.)protonmail\.ch$/.test(h)) return 'Proton Mail';
  if (/(^|\.)hostinger\.com$/.test(h)) return 'Hostinger';
  return null;
}

async function rdapCountry(net: Net, ip: string): Promise<{ country: string | null; name: string | null }> {
  const r = (await quiet(net.json(SOURCES.rdap(ip)), null)) as { country?: string; name?: string } | null;
  return { country: r?.country?.toUpperCase() ?? null, name: r?.name ?? null };
}

async function locate(net: Net, ranges: Known[], host: string, ip: string, what: string, kind: 'served' | 'mail', provider: string | null): Promise<Finding> {
  const m = bestMatch(ip, ranges);
  // Mail received at a worldwide edge is still stored wherever the mailbox is, which can't be seen from outside.
  if (m?.edge && kind === 'mail') return { where: `${host} (${ip})`, what, provider: provider ?? m.provider, region: null, country: null, kind, note: `received through ${m.provider}'s worldwide edge; where the mailbox is stored isn't visible: ask the provider` };
  if (m) {
    return { where: `${host} (${ip})`, what, provider: provider ?? m.provider, region: m.region, country: m.country, kind: m.edge ? 'edge' : kind };
  }
  const r = await rdapCountry(net, ip);
  return { where: `${host} (${ip})`, what, provider: provider ?? r.name ?? 'unknown network', region: null, country: r.country, kind, note: 'registered country of the network (RDAP), not proof of location' };
}

/** The site's own addresses and the addresses of its mail servers (CNAMEs followed by the resolver). */
export async function checkSite(net: Net, domain: string, extraHosts: string[] = []): Promise<Finding[]> {
  const ranges = await loadRanges(net);
  const findings: Finding[] = [];
  const hosts = [...new Set([domain, `www.${domain}`, ...extraHosts])];
  for (const host of hosts) {
    const cname = await quiet(net.resolveCname(host), [] as string[]);
    const ips = [...(await quiet(net.resolve4(host), [] as string[])), ...(await quiet(net.resolve6(host), [] as string[]))];
    for (const ip of ips) findings.push(await locate(net, ranges, host, ip, ip.includes(':') ? 'AAAA record' : 'A record', 'served', null));
    if (cname[0] && !ips.length) findings.push({ where: host, what: 'CNAME', provider: cname[0], region: null, country: null, kind: 'served', note: 'points elsewhere; no address found' });
  }
  const mx = await quiet(net.resolveMx(domain), []);
  for (const m of mx.sort((a, b) => a.priority - b.priority)) {
    const ips = await quiet(net.resolve4(m.exchange), [] as string[]);
    const name = mailProvider(m.exchange);
    // Mail goes to the first address that answers; one per server is enough to place it.
    if (ips[0]) findings.push(await locate(net, ranges, m.exchange, ips[0], 'MX (email)', 'mail', name));
    else findings.push({ where: m.exchange, what: 'MX (email)', provider: name ?? 'unknown', region: null, country: null, kind: 'mail', note: 'no address found' });
  }
  return group(findings);
}

/** One row per host and place: "sealdrop.ca · 12 addresses · AWS CloudFront edge", not one per address. */
export function group(findings: Finding[]): Finding[] {
  const rows = new Map<string, Finding & { n: number }>();
  for (const f of findings) {
    const host = f.where.replace(/ \(.*\)$/, '');
    const what = f.what.replace(/^(A|AAAA) record$/, 'website');
    const key = [host, what, f.provider, f.region, f.country, f.kind, f.note].join('|');
    const cur = rows.get(key);
    if (cur) cur.n++;
    else rows.set(key, { ...f, where: host, what, n: 1 });
  }
  return [...rows.values()].map(({ n, ...f }) => (n > 1 ? { ...f, what: `${f.what} (${n} addresses)` } : f));
}

export const SITE_CAVEATS = [
  'This shows where the website and email are served from. It cannot see databases, backups, logs or support tools: ask the vendor where those are.',
  'A content-delivery edge (CloudFront, Cloudflare, Fastly) serves copies worldwide by design; the data itself is kept elsewhere.',
  'Where no cloud range matches, the country is the network\'s registered country (RDAP), which is usually, but not always, where the servers are.',
];
