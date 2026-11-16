/**
 * data-residency-check: where is the data? For a website or vendor (no account needed), or your own AWS, Azure or
 * Google Cloud account. Exits 1 when something is outside the allowed countries, so it can run in CI.
 */
import dns from 'node:dns/promises';
import { checkAws, AWS_CAVEATS } from './providers/aws.ts';
import { checkAzure, AZURE_CAVEATS } from './providers/azure.ts';
import { checkGcp, GCP_CAVEATS } from './providers/gcp.ts';
import { runCli, type Run } from './providers/run.ts';
import { judge, toMarkdown, toText, type Finding, type Report } from './report.ts';
import { checkSite, SITE_CAVEATS, type Net } from './site.ts';

export const VERSION = '0.1.0';

const HELP = `data-residency-check ${VERSION}: where is the data?

  data-residency-check site <domain> --country CA [--host api.example.com]...
      Where a website (and www., and any --host) and its email are served from. No account needed:
      use it to check a vendor.
  data-residency-check aws --country CA [--regions ca-central-1,ca-west-1]
      Every region of your AWS account, read-only (AWS CLI and its credentials).
  data-residency-check azure --country CA [--subscription <id>]     (beta; Azure CLI, az login)
  data-residency-check gcp --country CA --project <project-id>       (beta; gcloud, Cloud Asset API)

Options:
  --country CA[,US]   Allowed countries (ISO codes). Required.
  --json | --markdown Output format (default: a table).
  --strict            Also exit 1 when a location is unknown.

Exit: 0 nothing outside the allowed countries · 1 something is · 2 a usage or access error.
Read-only. Sends nothing anywhere except DNS lookups and fetching the clouds' published IP ranges (site mode).
`;

export interface Args {
  mode: string;
  target?: string;
  country: string[];
  hosts: string[];
  regions: string[];
  subscription?: string;
  project?: string;
  format: 'text' | 'json' | 'markdown';
  strict: boolean;
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { mode: argv[0] ?? 'help', country: [], hosts: [], regions: [], format: 'text', strict: false };
  for (let i = 1; i < argv.length; i++) {
    const v = argv[i]!;
    const next = () => {
      const n = argv[++i];
      if (n === undefined) throw new Error(`${v} needs a value`);
      return n;
    };
    if (v === '--country') a.country.push(...next().split(',').map((c) => c.trim().toUpperCase()).filter(Boolean));
    else if (v === '--host') a.hosts.push(next());
    else if (v === '--regions') a.regions.push(...next().split(',').map((r) => r.trim()).filter(Boolean));
    else if (v === '--subscription') a.subscription = next();
    else if (v === '--project') a.project = next();
    else if (v === '--json') a.format = 'json';
    else if (v === '--markdown') a.format = 'markdown';
    else if (v === '--strict') a.strict = true;
    else if (!v.startsWith('--') && !a.target) a.target = v;
    else throw new Error(`Unknown option: ${v}`);
  }
  return a;
}

const realNet: Net = {
  resolve4: (h) => dns.resolve4(h),
  resolve6: (h) => dns.resolve6(h),
  resolveCname: (h) => dns.resolveCname(h),
  resolveMx: (h) => dns.resolveMx(h),
  json: async (url) => {
    const r = await fetch(url, { headers: { 'user-agent': `data-residency-check/${VERSION} (+https://github.com/SealdropCanada/data-residency-check)`, accept: 'application/json, application/rdap+json' }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.json();
  },
  text: async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    return r.text();
  },
};

/** Runs one check and builds the report; the clouds and the network are injected for tests. */
export async function run(a: Args, deps: { net: Net; cli: Run; now?: () => Date } = { net: realNet, cli: runCli }): Promise<Report> {
  if (!a.country.length) throw new Error('Name the allowed countries, for example: --country CA (or --country CA,US).');
  let findings: Finding[];
  let target: string;
  let caveats: string[];
  if (a.mode === 'site') {
    if (!a.target || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(a.target)) throw new Error('Name a domain, for example: data-residency-check site example.com --country CA');
    target = a.target.toLowerCase();
    findings = await checkSite(deps.net, target, a.hosts);
    caveats = SITE_CAVEATS;
  } else if (a.mode === 'aws') {
    const r = await checkAws(deps.cli, { regions: a.regions });
    target = `AWS account ${r.account} (${r.regions.length} regions)`;
    findings = r.findings;
    caveats = AWS_CAVEATS;
  } else if (a.mode === 'azure') {
    const r = await checkAzure(deps.cli, { subscription: a.subscription });
    target = `Azure subscription ${r.account}`;
    findings = r.findings;
    caveats = AZURE_CAVEATS;
  } else if (a.mode === 'gcp') {
    const r = await checkGcp(deps.cli, { project: a.project ?? '' });
    target = `Google Cloud project ${r.account}`;
    findings = r.findings;
    caveats = GCP_CAVEATS;
  } else {
    throw new Error(`Unknown check "${a.mode}". Use site, aws, azure or gcp.`);
  }
  return { tool: 'data-residency-check', version: VERSION, mode: a.mode, target, checkedAt: (deps.now ?? (() => new Date()))().toISOString(), allowed: a.country, findings, ...judge(findings, a.country), caveats };
}

export function exitCode(r: Report, strict: boolean): number {
  return r.outside.length || (strict && r.unknown.length) ? 1 : 0;
}

export async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || ['help', '--help', '-h'].includes(argv[0]!)) return void process.stdout.write(HELP);
  if (argv[0] === '--version') return void process.stdout.write(`${VERSION}\n`);
  try {
    const a = parseArgs(argv);
    const r = await run(a);
    process.stdout.write(a.format === 'json' ? JSON.stringify(r, null, 2) + '\n' : a.format === 'markdown' ? toMarkdown(r) : toText(r));
    process.exitCode = exitCode(r, a.strict);
  } catch (e) {
    process.stderr.write(`data-residency-check: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 2;
  }
}
