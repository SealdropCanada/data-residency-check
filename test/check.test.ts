import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bestMatch, parseCidr } from '../src/cidr.ts';
import { exitCode, parseArgs, run, VERSION } from '../src/cli.ts';
import type { Run } from '../src/providers/run.ts';
import { countryOf } from '../src/regions.ts';
import { toMarkdown } from '../src/report.ts';
import { SOURCES, type Net } from '../src/site.ts';

const NOW = () => new Date('2026-11-15T12:00:00Z');

/** A fake internet: DNS answers and the published ranges, nothing real. */
function fakeNet(dnsAnswers: Record<string, { a?: string[]; aaaa?: string[]; mx?: { exchange: string; priority: number }[] }>, rdap: Record<string, { country: string; name: string }> = {}): Net {
  const no = () => Promise.reject(Object.assign(new Error('ENODATA'), { code: 'ENODATA' }));
  return {
    resolve4: (h) => (dnsAnswers[h]?.a ? Promise.resolve(dnsAnswers[h]!.a!) : no()),
    resolve6: (h) => (dnsAnswers[h]?.aaaa ? Promise.resolve(dnsAnswers[h]!.aaaa!) : no()),
    resolveCname: () => no(),
    resolveMx: (h) => (dnsAnswers[h]?.mx ? Promise.resolve(dnsAnswers[h]!.mx!) : no()),
    json: async (url) => {
      if (url === SOURCES.aws) return { prefixes: [{ ip_prefix: '15.156.0.0/15', region: 'ca-central-1', service: 'AMAZON' }, { ip_prefix: '3.160.0.0/14', region: 'GLOBAL', service: 'CLOUDFRONT' }, { ip_prefix: '52.0.0.0/11', region: 'us-east-1', service: 'AMAZON' }], ipv6_prefixes: [{ ipv6_prefix: '2600:9000::/28', region: 'GLOBAL', service: 'CLOUDFRONT' }] };
      if (url === SOURCES.gcp) return { prefixes: [{ ipv4Prefix: '34.95.0.0/16', scope: 'northamerica-northeast1' }] };
      if (url === SOURCES.fastly) return { addresses: [], ipv6_addresses: [] };
      const ip = url.split('/ip/')[1];
      if (ip && rdap[decodeURIComponent(ip)]) return rdap[decodeURIComponent(ip)];
      throw new Error('404');
    },
    text: async (url) => (url === SOURCES.cloudflare4 ? '104.16.0.0/13\n' : ''),
  };
}

test('CIDR: IPv4 and IPv6, the most specific range wins', () => {
  const ranges = ['52.0.0.0/11', '52.94.0.0/16'].map((c, i) => ({ range: parseCidr(c)!, i }));
  assert.equal(bestMatch('52.94.1.2', ranges)?.i, 1);
  assert.equal(bestMatch('52.1.1.1', ranges)?.i, 0);
  assert.equal(bestMatch('8.8.8.8', ranges), null);
  assert.ok(bestMatch('2600:9000:2001::1', [{ range: parseCidr('2600:9000::/28')! }]));
  assert.equal(bestMatch('2001:db8::1', [{ range: parseCidr('2600:9000::/28')! }]), null);
});

test('regions to countries, for every cloud; zones count as their region; unknown is never guessed', () => {
  assert.equal(countryOf('aws', 'ca-central-1'), 'CA');
  assert.equal(countryOf('aws', 'ca-west-1'), 'CA');
  assert.equal(countryOf('aws', 'eu-west-2'), 'GB');
  assert.equal(countryOf('gcp', 'northamerica-northeast2'), 'CA');
  assert.equal(countryOf('gcp', 'northamerica-northeast1-b'), 'CA');
  assert.equal(countryOf('gcp', 'eu'), 'EU');
  assert.equal(countryOf('azure', 'canadacentral'), 'CA');
  assert.equal(countryOf('azure', 'Canada Central'), 'CA');
  assert.equal(countryOf('azure', 'atlantis'), null);
});

test('site: a Canadian site behind a CDN, with mail elsewhere: edges listed, not counted; mail outside is', async () => {
  const net = fakeNet(
    {
      'firm.example': { a: ['3.160.1.1'], aaaa: ['2600:9000:2001::1'], mx: [{ exchange: 'mx1.mail.example', priority: 10 }] },
      'www.firm.example': { a: ['15.156.10.10'] },
      'api.firm.example': { a: ['34.95.1.1'] },
      'mx1.mail.example': { a: ['198.51.100.7'] },
    },
    { '198.51.100.7': { country: 'us', name: 'EXAMPLE-MAIL-NET' } },
  );
  const r = await run(parseArgs(['site', 'firm.example', '--country', 'CA', '--host', 'api.firm.example']), { net, cli: async () => null, now: NOW });
  const by = (where: string) => r.findings.find((f) => f.where === where);
  // One row per host and place, the addresses counted.
  assert.deepEqual(r.findings.filter((f) => f.where === 'firm.example').map((f) => [f.what, f.kind]), [['website (2 addresses)', 'edge']]);
  assert.equal(by('www.firm.example')?.country, 'CA');
  assert.equal(by('www.firm.example')?.region, 'ca-central-1');
  assert.equal(by('api.firm.example')?.provider, 'Google Cloud');
  assert.deepEqual(r.outside.map((f) => [f.what, f.country]), [['MX (email)', 'US']]);
  assert.match(by('mx1.mail.example')!.note!, /RDAP/);
  assert.equal(exitCode(r, false), 1);
});

test('aws: every region and S3 bucket; certificates in us-east-1 are listed but never "outside"; names only', async () => {
  const calls: string[][] = [];
  const cli: Run = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const at = args.indexOf('--region');
    const region = at >= 0 ? args[at + 1] : undefined;
    const key = `${args[0]} ${args[1]}`;
    if (key === 'sts get-caller-identity') return { Account: '123456789012' };
    if (key === 'ec2 describe-regions') return { Regions: [{ RegionName: 'ca-central-1' }, { RegionName: 'us-east-1' }] };
    if (key === 'dynamodb list-tables') return { TableNames: region === 'ca-central-1' ? ['orders'] : [] };
    if (key === 'logs describe-log-groups') return { logGroups: region === 'us-east-1' ? [{ logGroupName: '/forgotten/test' }] : [] };
    if (key === 's3api list-buckets') return { Buckets: [{ Name: 'files' }, { Name: 'old-us' }] };
    if (key === 's3api get-bucket-location') return { LocationConstraint: args[3] === 'files' ? 'ca-central-1' : null };
    if (key === 'acm list-certificates') return { CertificateSummaryList: [{ DomainName: 'firm.example' }] };
    if (key === 'cloudfront list-distributions') return { DistributionList: { Items: [{ Id: 'E1', DomainName: 'd1.cloudfront.net' }] } };
    return {};
  };
  const r = await run(parseArgs(['aws', '--country', 'CA', '--json']), { net: fakeNet({}), cli, now: NOW });
  assert.equal(r.target, 'AWS account …9012 (2 regions)');
  assert.deepEqual(r.outside.map((f) => `${f.what} ${f.where} ${f.region}`).sort(), ['CloudWatch log group /forgotten/test us-east-1', 'S3 bucket old-us us-east-1']);
  assert.ok(r.findings.some((f) => f.what === 'ACM certificate' && f.kind === 'global'));
  assert.ok(r.findings.some((f) => f.what === 'CloudFront distribution' && f.kind === 'edge'));
  // Read-only: only list/describe/get calls.
  assert.ok(calls.every((c) => /^(list|describe|get)-/.test(c[2]!)), calls.map((c) => c[2]).join(','));
  assert.match(toMarkdown(r), /\*\*Result:\*\* 2 found outside CA\./);
});

test('azure (beta) and gcp (beta): each resource\'s location; global and multi-region handled', async () => {
  const az: Run = async (_c, args) => (args[0] === 'account' ? { id: 'sub-0000-1111' } : [{ name: 'files', type: 'Microsoft.Storage/storageAccounts', location: 'canadacentral' }, { name: 'zone', type: 'Microsoft.Network/dnszones', location: 'global' }, { name: 'db', type: 'Microsoft.Sql/servers', location: 'eastus' }]);
  const a = await run(parseArgs(['azure', '--country', 'CA']), { net: fakeNet({}), cli: az, now: NOW });
  assert.deepEqual(a.outside.map((f) => f.where), ['db']);
  const gc: Run = async () => [{ name: '//storage.googleapis.com/projects/_/buckets/docs', assetType: 'storage.googleapis.com/Bucket', location: 'northamerica-northeast1' }, { name: '//storage.googleapis.com/projects/_/buckets/eu', assetType: 'storage.googleapis.com/Bucket', location: 'eu' }];
  const g = await run(parseArgs(['gcp', '--country', 'CA', '--project', 'my-proj']), { net: fakeNet({}), cli: gc, now: NOW });
  assert.deepEqual(g.outside.map((f) => [f.where, f.country, f.note]), [['eu', 'EU', 'multi-region']]);
});

test('mail received at a worldwide edge is unknown, never "edge": the mailbox could be anywhere', async () => {
  const net = fakeNet({ 'firm.example': { a: ['15.156.10.10'], mx: [{ exchange: 'mx1.host.example', priority: 10 }] }, 'mx1.host.example': { a: ['104.16.5.5'] } });
  const r = await run(parseArgs(['site', 'firm.example', '--country', 'CA']), { net, cli: async () => null, now: NOW });
  const mx = r.findings.find((f) => f.what === 'MX (email)')!;
  assert.equal(mx.kind, 'mail');
  assert.equal(mx.country, null);
  assert.match(mx.note!, /ask the provider/);
  assert.equal(r.unknown.length, 1);
});

test('only edges: the summary says nothing can be seen, rather than "nothing outside"', async () => {
  const r = await run(parseArgs(['site', 'cdn.example', '--country', 'CA']), { net: fakeNet({ 'cdn.example': { a: ['3.160.1.1'] } }), cli: async () => null, now: NOW });
  assert.match(toMarkdown(r), /isn't visible from here/);
});

test('usage: countries are required; a bad domain or mode is refused; --strict fails on unknown', async () => {
  await assert.rejects(run(parseArgs(['site', 'example.com']), { net: fakeNet({}), cli: async () => null }), /--country/);
  await assert.rejects(run(parseArgs(['site', 'not a domain', '--country', 'CA']), { net: fakeNet({}), cli: async () => null }), /domain/);
  await assert.rejects(run(parseArgs(['oracle', '--country', 'CA']), { net: fakeNet({}), cli: async () => null }), /Unknown check/);
  assert.throws(() => parseArgs(['site', 'a.com', '--nope']), /Unknown option/);
  const r = await run(parseArgs(['site', 'quiet.example', '--country', 'CA']), { net: fakeNet({ 'quiet.example': { a: ['192.0.2.1'] } }), cli: async () => null, now: NOW });
  assert.equal(r.unknown.length, 1);
  assert.equal(exitCode(r, false), 0);
  assert.equal(exitCode(r, true), 1);
});

test('the version matches package.json', () => {
  assert.equal(VERSION, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
});
