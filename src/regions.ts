/**
 * Where each cloud region is, as an ISO 3166 country code. Regions not listed fall back to their name's prefix where
 * that's unambiguous; otherwise they're reported as unknown (never guessed).
 */
export type Cloud = 'aws' | 'gcp' | 'azure';

const AWS: Record<string, string> = {
  'af-south-1': 'ZA', 'ap-east-1': 'HK', 'ap-east-2': 'TW', 'ap-northeast-1': 'JP', 'ap-northeast-2': 'KR', 'ap-northeast-3': 'JP',
  'ap-south-1': 'IN', 'ap-south-2': 'IN', 'ap-southeast-1': 'SG', 'ap-southeast-2': 'AU', 'ap-southeast-3': 'ID',
  'ap-southeast-4': 'AU', 'ap-southeast-5': 'MY', 'ap-southeast-6': 'NZ', 'ap-southeast-7': 'TH', 'ca-central-1': 'CA',
  'ca-west-1': 'CA', 'cn-north-1': 'CN', 'cn-northwest-1': 'CN', 'eu-central-1': 'DE', 'eu-central-2': 'CH',
  'eu-north-1': 'SE', 'eu-south-1': 'IT', 'eu-south-2': 'ES', 'eu-west-1': 'IE', 'eu-west-2': 'GB', 'eu-west-3': 'FR',
  'il-central-1': 'IL', 'me-central-1': 'AE', 'me-south-1': 'BH', 'mx-central-1': 'MX', 'sa-east-1': 'BR',
  'us-east-1': 'US', 'us-east-2': 'US', 'us-west-1': 'US', 'us-west-2': 'US', 'us-gov-east-1': 'US', 'us-gov-west-1': 'US',
};

const GCP: Record<string, string> = {
  'africa-south1': 'ZA', 'asia-east1': 'TW', 'asia-east2': 'HK', 'asia-northeast1': 'JP', 'asia-northeast2': 'JP',
  'asia-northeast3': 'KR', 'asia-south1': 'IN', 'asia-south2': 'IN', 'asia-southeast1': 'SG', 'asia-southeast2': 'ID',
  'australia-southeast1': 'AU', 'australia-southeast2': 'AU', 'europe-central2': 'PL', 'europe-north1': 'FI',
  'europe-north2': 'SE', 'europe-southwest1': 'ES', 'europe-west1': 'BE', 'europe-west2': 'GB', 'europe-west3': 'DE',
  'europe-west4': 'NL', 'europe-west6': 'CH', 'europe-west8': 'IT', 'europe-west9': 'FR', 'europe-west10': 'DE',
  'europe-west12': 'IT', 'me-central1': 'QA', 'me-central2': 'SA', 'me-west1': 'IL', 'northamerica-northeast1': 'CA',
  'northamerica-northeast2': 'CA', 'northamerica-south1': 'MX', 'southamerica-east1': 'BR', 'southamerica-west1': 'CL',
  'us-central1': 'US', 'us-east1': 'US', 'us-east4': 'US', 'us-east5': 'US', 'us-south1': 'US', 'us-west1': 'US',
  'us-west2': 'US', 'us-west3': 'US', 'us-west4': 'US',
  // Multi-regions: a group of countries, reported as such.
  us: 'US', eu: 'EU', asia: 'ASIA', nam4: 'US', eur4: 'EU', eur5: 'EU', nam5: 'US', eur3: 'EU',
};

const AZURE: Record<string, string> = {
  canadacentral: 'CA', canadaeast: 'CA', eastus: 'US', eastus2: 'US', centralus: 'US', northcentralus: 'US',
  southcentralus: 'US', westcentralus: 'US', westus: 'US', westus2: 'US', westus3: 'US', northeurope: 'IE',
  westeurope: 'NL', uksouth: 'GB', ukwest: 'GB', francecentral: 'FR', francesouth: 'FR', germanywestcentral: 'DE',
  germanynorth: 'DE', switzerlandnorth: 'CH', switzerlandwest: 'CH', norwayeast: 'NO', norwaywest: 'NO',
  swedencentral: 'SE', polandcentral: 'PL', italynorth: 'IT', spaincentral: 'ES', japaneast: 'JP', japanwest: 'JP',
  koreacentral: 'KR', koreasouth: 'KR', australiaeast: 'AU', australiasoutheast: 'AU', australiacentral: 'AU',
  southeastasia: 'SG', eastasia: 'HK', centralindia: 'IN', southindia: 'IN', westindia: 'IN', brazilsouth: 'BR',
  southafricanorth: 'ZA', uaenorth: 'AE', qatarcentral: 'QA', israelcentral: 'IL', mexicocentral: 'MX',
  newzealandnorth: 'NZ',
};

/** Locations that aren't a place: global services and edges. */
export const GLOBAL = new Set(['global', 'GLOBAL', 'aws-global']);

/** The country of a cloud region, or null when unknown. A Google zone (us-east1-b) counts as its region. */
export function countryOf(cloud: Cloud, region: string): string | null {
  const r = region.trim();
  if (cloud === 'aws') return AWS[r] ?? (r.startsWith('ca-') ? 'CA' : r.startsWith('us-') ? 'US' : null);
  if (cloud === 'azure') return AZURE[r.toLowerCase().replace(/\s+/g, '')] ?? null;
  const base = r.replace(/-[a-z]$/, '');
  return GCP[base] ?? GCP[r] ?? (base.startsWith('us-') ? 'US' : null);
}
