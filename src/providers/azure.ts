/**
 * Beta. An Azure subscription's resources and where each is, from `az resource list` (the Azure CLI, signed in with
 * `az login`; Reader access is enough). Every Azure resource reports its location, so one call covers them all.
 */
import { countryOf } from '../regions.ts';
import type { Finding } from '../report.ts';
import type { Run } from './run.ts';

/** Resource types that only describe things (no data); listed, but as global when their location is "global". */
export async function checkAzure(run: Run, opts: { subscription?: string } = {}): Promise<{ account: string; findings: Finding[] }> {
  const sub = (await run('az', ['account', 'show', ...(opts.subscription ? ['--subscription', opts.subscription] : []), '--output', 'json'])) as { id?: string; name?: string } | null;
  if (!sub?.id) throw new Error('Not signed in to Azure. Run: az login (and az account set --subscription <id>).');
  const list = (await run('az', ['resource', 'list', ...(opts.subscription ? ['--subscription', opts.subscription] : []), '--output', 'json'])) as { name: string; type: string; location?: string }[] | null;
  if (!Array.isArray(list)) throw new Error('Could not list resources (az resource list).');
  const findings: Finding[] = list.map((r) => {
    const loc = (r.location ?? '').toLowerCase();
    const isGlobal = !loc || loc === 'global';
    return { where: r.name, what: r.type.split('/').slice(1).join('/') || r.type, provider: 'Azure', region: isGlobal ? null : loc, country: isGlobal ? null : countryOf('azure', loc), kind: isGlobal ? 'global' : 'stored' };
  });
  findings.sort((a, b) => (a.region ?? '').localeCompare(b.region ?? '') || a.what.localeCompare(b.what));
  return { account: `…${sub.id.slice(-4)}`, findings };
}

export const AZURE_CAVEATS = [
  'Beta: built against the Azure CLI\'s documented output; please report anything that looks wrong.',
  'Lists every resource the signed-in account can read, with its location. Global resources (DNS zones, Front Door…) are listed, never counted as outside.',
];
