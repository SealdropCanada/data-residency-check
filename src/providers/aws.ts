/**
 * An AWS account's inventory: every enabled region, every service that can hold data, read-only, names and counts
 * only — never contents. Uses the AWS CLI and whatever credentials it has (AWS_PROFILE, SSO…). Needs read-only
 * permissions such as the AWS managed policy ViewOnlyAccess or ReadOnlyAccess.
 */
import { countryOf } from '../regions.ts';
import type { Finding } from '../report.ts';
import { limit, type Run } from './run.ts';

interface Check {
  what: string;
  args: string[];
  /** Names from the CLI's answer. */
  names: (out: any) => string[];
}

const get = (o: any, k: string): any[] => (Array.isArray(o?.[k]) ? o[k] : []);

/** Per-region services that can hold data. */
export const AWS_CHECKS: Check[] = [
  { what: 'DynamoDB table', args: ['dynamodb', 'list-tables'], names: (o) => get(o, 'TableNames') },
  { what: 'RDS instance', args: ['rds', 'describe-db-instances'], names: (o) => get(o, 'DBInstances').map((d) => d.DBInstanceIdentifier) },
  { what: 'RDS/Aurora cluster', args: ['rds', 'describe-db-clusters'], names: (o) => get(o, 'DBClusters').map((d) => d.DBClusterIdentifier) },
  { what: 'EFS file system', args: ['efs', 'describe-file-systems'], names: (o) => get(o, 'FileSystems').map((f) => f.FileSystemId) },
  { what: 'EBS volume', args: ['ec2', 'describe-volumes', '--query', 'Volumes[].VolumeId'], names: (o) => (Array.isArray(o) ? o : []) },
  { what: 'Lambda function', args: ['lambda', 'list-functions'], names: (o) => get(o, 'Functions').map((f) => f.FunctionName) },
  { what: 'Cognito user pool', args: ['cognito-idp', 'list-user-pools', '--max-results', '60'], names: (o) => get(o, 'UserPools').map((p) => p.Name) },
  { what: 'KMS key (customer)', args: ['kms', 'list-aliases'], names: (o) => get(o, 'Aliases').filter((a) => a.TargetKeyId && !String(a.AliasName).startsWith('alias/aws/')).map((a) => a.AliasName) },
  { what: 'Secrets Manager secret', args: ['secretsmanager', 'list-secrets'], names: (o) => get(o, 'SecretList').map((s) => s.Name) },
  { what: 'CloudWatch log group', args: ['logs', 'describe-log-groups'], names: (o) => get(o, 'logGroups').map((g) => g.logGroupName) },
  { what: 'SQS queue', args: ['sqs', 'list-queues'], names: (o) => get(o, 'QueueUrls').map((u: string) => u.split('/').pop()!) },
  { what: 'SNS topic', args: ['sns', 'list-topics'], names: (o) => get(o, 'Topics').map((t) => String(t.TopicArn).split(':').pop()!) },
  { what: 'Kinesis stream', args: ['kinesis', 'list-streams'], names: (o) => get(o, 'StreamNames') },
  { what: 'OpenSearch domain', args: ['opensearch', 'list-domain-names'], names: (o) => get(o, 'DomainNames').map((d) => d.DomainName) },
  { what: 'ElastiCache cluster', args: ['elasticache', 'describe-cache-clusters'], names: (o) => get(o, 'CacheClusters').map((c) => c.CacheClusterId) },
  { what: 'Backup vault (with backups)', args: ['backup', 'list-backup-vaults'], names: (o) => get(o, 'BackupVaultList').filter((v) => v.NumberOfRecoveryPoints > 0).map((v) => v.BackupVaultName) },
  { what: 'SES identity', args: ['sesv2', 'list-email-identities'], names: (o) => get(o, 'EmailIdentities').map((i) => i.IdentityName) },
  { what: 'API Gateway API', args: ['apigatewayv2', 'get-apis'], names: (o) => get(o, 'Items').map((a) => a.Name) },
  { what: 'ECR repository', args: ['ecr', 'describe-repositories'], names: (o) => get(o, 'repositories').map((r) => r.repositoryName) },
];

export async function checkAws(run: Run, opts: { regions?: string[]; concurrency?: number } = {}): Promise<{ account: string; regions: string[]; findings: Finding[] }> {
  const who = (await run('aws', ['sts', 'get-caller-identity', '--output', 'json'])) as { Account?: string } | null;
  if (!who?.Account) throw new Error('No AWS credentials. Sign in first (for example: aws sso login --profile <name>, then AWS_PROFILE=<name>).');
  const all = (await run('aws', ['ec2', 'describe-regions', '--output', 'json'])) as { Regions?: { RegionName: string }[] } | null;
  const regions = opts.regions?.length ? opts.regions : (all?.Regions ?? []).map((r) => r.RegionName).sort();
  if (!regions.length) throw new Error('Could not list the account\'s regions (ec2:DescribeRegions).');
  const findings: Finding[] = [];
  const tasks = regions.flatMap((region) =>
    AWS_CHECKS.map((c) => async () => {
      const out = await run('aws', [...c.args, '--region', region, '--output', 'json']);
      for (const name of out ? c.names(out) : []) findings.push({ where: name, what: c.what, provider: 'AWS', region, country: countryOf('aws', region), kind: 'stored' });
    }),
  );
  await limit(opts.concurrency ?? 8, tasks);
  // S3 is global: each bucket has its own region (an empty location means us-east-1).
  const buckets = (await run('aws', ['s3api', 'list-buckets', '--output', 'json'])) as { Buckets?: { Name: string }[] } | null;
  await limit(
    opts.concurrency ?? 8,
    (buckets?.Buckets ?? []).map((b) => async () => {
      const loc = (await run('aws', ['s3api', 'get-bucket-location', '--bucket', b.Name, '--output', 'json'])) as { LocationConstraint?: string | null } | null;
      const region = loc ? (loc.LocationConstraint || 'us-east-1') : null;
      findings.push({ where: b.Name, what: 'S3 bucket', provider: 'AWS', region, country: region ? countryOf('aws', region) : null, kind: 'stored' });
    }),
  );
  // CloudFront distributions are edges; their certificates must be in us-east-1 (domain names only).
  const cf = (await run('aws', ['cloudfront', 'list-distributions', '--output', 'json'])) as { DistributionList?: { Items?: { Id: string; DomainName: string }[] } } | null;
  for (const d of cf?.DistributionList?.Items ?? []) findings.push({ where: d.DomainName, what: 'CloudFront distribution', provider: 'AWS', region: null, country: null, kind: 'edge' });
  const certs = (await run('aws', ['acm', 'list-certificates', '--region', 'us-east-1', '--output', 'json'])) as { CertificateSummaryList?: { DomainName: string }[] } | null;
  for (const c of certs?.CertificateSummaryList ?? []) findings.push({ where: c.DomainName, what: 'ACM certificate', provider: 'AWS', region: 'us-east-1', country: 'US', kind: 'global', note: 'CloudFront requires us-east-1; holds domain names only' });
  findings.sort((a, b) => (a.region ?? '').localeCompare(b.region ?? '') || a.what.localeCompare(b.what) || a.where.localeCompare(b.where));
  return { account: `…${who.Account.slice(-4)}`, regions, findings };
}

export const AWS_CAVEATS = [
  'Read-only: lists names and counts, never contents. Services not in the list (and resources the credentials can\'t see) are not covered.',
  'CloudFront certificates must live in us-east-1 and hold domain names only: listed, never counted as outside.',
];
