# data-residency-check

**Where is the data?** Check where a website or vendor is served from, or list every resource in your AWS, Azure or
Google Cloud account by country. Read-only, no dependencies, and it exits with an error when something is outside the
countries you allow, so it can guard a CI pipeline.

```
npx data-residency-check site example.com --country CA
npx data-residency-check aws --country CA
```

Built by [SealDrop](https://sealdrop.ca), a Canadian document-collection service, to prove our own residency
([our published report](https://sealdrop.ca/trust/residency/)). We use it on ourselves every release and share it
because every small firm and every builder gets asked the same question: *"Is our data stored in Canada?"* (or the
EU, Australia…).

---

## Why "stored in Canada" is harder than it sounds

Data residency is only true if **every copy** is in the country: files, databases, backups, logs, disaster-recovery
copies and encryption keys. Most leaks of residency aren't the main database. They're a backup replicated "for
resilience", a forgotten test bucket in `us-east-1`, a log group, or a support tool. This tool finds those.

It also helps you read what you see from outside: a website behind a content-delivery network (CloudFront,
Cloudflare, Fastly) is *served* from edges worldwide by design. That says nothing about where its data is *kept*, and
this tool says so instead of pretending.

## Checks

### `site <domain>`: check a website or a vendor (no account needed)

```
data-residency-check site example.com --country CA [--host api.example.com --host app.example.com]
```

For the domain, `www.`, any `--host`, and the domain's **mail servers (MX)**, it finds the addresses and places each
one:

- **AWS and Google Cloud** addresses by **region** (both publish which address ranges belong to which region);
- **CloudFront, Cloudflare, Fastly** as **worldwide edges**: listed, never counted as "outside";
- anything else by the network's **registered country** (RDAP), marked as such.

Email received through an edge is reported as **unknown**: the mailbox could be stored anywhere, so ask the provider.

Example (SealDrop's own site, 2026-11-15):

```
WHERE               WHAT                      PROVIDER        REGION   COUNTRY
sealdrop.ca         website (12 addresses)    AWS CloudFront  -        edge (worldwide)
app.sealdrop.ca     website (12 addresses)    AWS CloudFront  -        edge (worldwide)
mx1.hostinger.com   MX (email)                Hostinger       -        ?  (received through Cloudflare's worldwide edge…)

Nothing found outside CA. 2 with an unknown location (see the table).
```

A site check **can't see databases, backups or logs**. Pair it with the questions below.

### `aws`: your AWS account, every region

```
AWS_PROFILE=my-account data-residency-check aws --country CA [--regions ca-central-1,ca-west-1]
```

Uses the AWS CLI and its credentials (read-only: the `ViewOnlyAccess` or `ReadOnlyAccess` managed policy is enough).
In every enabled region it lists DynamoDB tables, RDS instances and clusters, EFS, EBS volumes, Lambda functions,
Cognito user pools, customer KMS keys, Secrets Manager, CloudWatch log groups, SQS, SNS, Kinesis, OpenSearch,
ElastiCache, Backup vaults with backups, SES identities, API Gateway APIs and ECR repositories. It also lists each
S3 bucket's own region, CloudFront distributions (edges) and the ACM certificates CloudFront requires in `us-east-1`
(listed as global, never "outside"). **Names and counts only, never contents.**

### `azure` (beta) and `gcp` (beta)

```
data-residency-check azure --country CA [--subscription <id>]      # Azure CLI, after az login (Reader)
data-residency-check gcp --country CA --project <project-id>       # gcloud, Cloud Asset API, Cloud Asset Viewer
```

Every resource and its location, from `az resource list` and Cloud Asset Inventory. Google multi-regions (`us`, `eu`,
`asia`) are flagged as such. **Beta:** built and tested against the documented output, not yet on many real accounts.
Reports and pull requests are very welcome.

## Options and output

| Option | |
|---|---|
| `--country CA[,US]` | Allowed countries (ISO codes). Required. |
| `--json` | Machine-readable report (`findings`, `outside`, `unknown`, `caveats`). |
| `--markdown` | A table to publish on a trust page or attach to a security questionnaire. |
| `--strict` | Also fail when a location is unknown. |

Exit codes: `0` nothing outside the allowed countries · `1` something is · `2` a usage or access error.

## In CI (GitHub Actions)

Fail the build when anything appears outside Canada:

```yaml
name: residency
on: [push, schedule]   # add: schedule: - cron: '0 6 * * 1'
permissions: { id-token: write, contents: read }
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with: { role-to-assume: arn:aws:iam::<account>:role/residency-read-only, aws-region: ca-central-1 }
      - run: npx data-residency-check aws --country CA --markdown >> "$GITHUB_STEP_SUMMARY"
```

## 8 questions to ask any vendor

A site check shows where a service is served from. For the rest, ask:

1. **Which region**, by name, holds the files and the database?
2. Where are **backups and disaster-recovery** copies?
3. Where do **logs** go, and do they contain personal data?
4. Where are the **encryption keys**, and who can use them?
5. Can the service be **deployed outside the country by mistake**? Is there an automated check (like this one)?
6. What **leaves the country anyway** (email, support tools, analytics)?
7. Who is the **parent company**, and in which country? (Residency is *where*; control is *who can be compelled*.)
8. When is data **deleted**, and is it really gone (no hidden versions)?

Not legal advice. In Canada, PIPEDA leaves you accountable for data you send elsewhere, and Québec's Law 25 requires a
privacy impact assessment before personal information leaves Québec; check your own rules.

## Privacy of this tool

It's read-only and keeps nothing. `site` makes DNS lookups and downloads the public range lists from AWS, Google,
Cloudflare and Fastly; for addresses none of them cover, it asks [rdap.org](https://rdap.org) about that address. The
cloud checks call only `list`/`describe`/`get` commands through your own CLI, and nothing is sent anywhere else.

## Contributing

Ideas that help everyone: more AWS services, region-to-country updates (`src/regions.ts`), more CDN and mail-provider
ranges, other clouds (Oracle, DigitalOcean, OVHcloud…), and real-world reports from the Azure and Google Cloud betas.

```
npm install
npm test          # node --test, no network or cloud account needed
npm run build
```

Please keep it dependency-free and read-only.

## Licence

MIT. Made by [SealDrop](https://sealdrop.ca), Canadian document collection: secure upload links, stored in AWS
Montréal, deleted after you file. If this helped you, tell us; we'd love to hear what you checked.
