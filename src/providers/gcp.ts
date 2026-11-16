/**
 * Beta. A Google Cloud project's resources and where each is, from Cloud Asset Inventory
 * (`gcloud asset search-all-resources`; needs the Cloud Asset API enabled and the Cloud Asset Viewer role).
 */
import { countryOf } from '../regions.ts';
import type { Finding } from '../report.ts';
import type { Run } from './run.ts';

export async function checkGcp(run: Run, opts: { project: string }): Promise<{ account: string; findings: Finding[] }> {
  if (!opts.project) throw new Error('Name the project: data-residency-check gcp --project <project-id>');
  const list = (await run('gcloud', ['asset', 'search-all-resources', `--scope=projects/${opts.project}`, '--format=json'])) as { name: string; assetType: string; location?: string; displayName?: string }[] | null;
  if (!Array.isArray(list)) throw new Error('Could not search resources. Sign in (gcloud auth login), enable the Cloud Asset API, and check the Cloud Asset Viewer role.');
  const findings: Finding[] = list.map((r) => {
    const loc = (r.location ?? 'global').toLowerCase();
    const isGlobal = loc === 'global';
    return {
      where: r.displayName || r.name.split('/').pop() || r.name,
      what: r.assetType.replace(/\.googleapis\.com\//, ' '),
      provider: 'Google Cloud',
      region: isGlobal ? null : loc,
      country: isGlobal ? null : countryOf('gcp', loc),
      kind: isGlobal ? 'global' : 'stored',
      ...(['us', 'eu', 'asia'].includes(loc) ? { note: 'multi-region' } : {}),
    };
  });
  findings.sort((a, b) => (a.region ?? '').localeCompare(b.region ?? '') || a.what.localeCompare(b.what));
  return { account: opts.project, findings };
}

export const GCP_CAVEATS = [
  'Beta: built against Cloud Asset Inventory\'s documented output; please report anything that looks wrong.',
  'A multi-region (us, eu, asia) stores data in several countries of that area; "global" resources are listed, never counted as outside.',
];
