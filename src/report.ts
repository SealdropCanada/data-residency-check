/** One thing found, where it is, and what the result means against the allowed countries. */
export type Kind =
  /** Holds data: a bucket, a database, a key… (cloud inventories). */
  | 'stored'
  /** Serves a website or an API from here (site checks). */
  | 'served'
  /** Receives email here (site checks). */
  | 'mail'
  /** A content-delivery edge: worldwide by design, not where data is kept. */
  | 'edge'
  /** A global service with no single location (IAM, DNS…). */
  | 'global';

export interface Finding {
  /** The hostname or resource. */
  where: string;
  /** What it is: "A record", "MX", "S3 bucket"… */
  what: string;
  provider: string;
  region: string | null;
  country: string | null;
  kind: Kind;
  note?: string;
}

export interface Report {
  tool: 'data-residency-check';
  version: string;
  mode: string;
  target: string;
  checkedAt: string;
  allowed: string[];
  findings: Finding[];
  outside: Finding[];
  unknown: Finding[];
  /** Plain-English limits of this check. */
  caveats: string[];
}

/** Edges and global services are listed, never counted as outside; an unknown country is its own list. */
export function judge(findings: Finding[], allowed: string[]): { outside: Finding[]; unknown: Finding[] } {
  const ok = new Set(allowed.map((c) => c.toUpperCase()));
  const counted = findings.filter((f) => f.kind !== 'edge' && f.kind !== 'global');
  return {
    outside: counted.filter((f) => f.country && !ok.has(f.country)),
    unknown: counted.filter((f) => !f.country),
  };
}

/** One honest sentence: outside, unknown, or only edges (nothing to see from outside). */
export function summary(r: Report): string {
  const counted = r.findings.filter((f) => f.kind !== 'edge' && f.kind !== 'global');
  if (r.outside.length) return `${r.outside.length} found outside ${r.allowed.join('/')}.${r.unknown.length ? ` ${r.unknown.length} with an unknown location.` : ''}`;
  if (!counted.length) return `Nothing outside ${r.allowed.join('/')} can be seen: everything found is a worldwide edge or a global service, so where the data is kept isn't visible from here.`;
  return `Nothing found outside ${r.allowed.join('/')}.${r.unknown.length ? ` ${r.unknown.length} with an unknown location (see the table).` : ''}`;
}

const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length));

export function toText(r: Report): string {
  const lines = [
    `data-residency-check ${r.mode}: ${r.target}`,
    `Allowed: ${r.allowed.join(', ')} · checked ${r.checkedAt}`,
    '',
    `${pad('WHERE', 34)}${pad('WHAT', 26)}${pad('PROVIDER', 22)}${pad('REGION', 26)}COUNTRY`,
    ...r.findings.map((f) => `${pad(f.where, 34)}${pad(f.what, 26)}${pad(f.provider, 22)}${pad(f.region ?? '-', 26)}${f.kind === 'edge' ? 'edge (worldwide)' : f.kind === 'global' ? 'global' : (f.country ?? '?')}${f.note ? `  (${f.note})` : ''}`),
    '',
    summary(r),
    ...r.outside.map((f) => `  - ${f.what} ${f.where}: ${f.region ?? ''} ${f.country}`),
    '',
    ...r.caveats.map((c) => `Note: ${c}`),
  ];
  return lines.join('\n') + '\n';
}

export function toMarkdown(r: Report): string {
  const cell = (s: string | null) => (s ?? '-').replace(/\|/g, '\\|');
  return [
    `## Data residency check: ${cell(r.target)}`,
    '',
    `Checked ${r.checkedAt} with [data-residency-check](https://github.com/SealdropCanada/data-residency-check) ${r.version} (${r.mode}). Allowed: ${r.allowed.join(', ')}.`,
    '',
    `**Result:** ${summary(r)}`,
    '',
    '| Where | What | Provider | Region | Country |',
    '|---|---|---|---|---|',
    ...r.findings.map((f) => `| ${cell(f.where)} | ${cell(f.what)} | ${cell(f.provider)} | ${cell(f.region)} | ${f.kind === 'edge' ? 'edge (worldwide)' : f.kind === 'global' ? 'global' : cell(f.country)} |`),
    '',
    ...r.caveats.map((c) => `> ${c}`),
    '',
  ].join('\n');
}
