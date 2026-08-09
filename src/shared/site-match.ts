// Site allowlist matching, shared by Options, the content script, and the
// service worker. Entries are stored as bare lowercase hostnames.

const STRIP_SUBDOMAINS = /^(www|m|amp)\./;

// Accepts a full URL, "www.nytimes.com", or "nytimes.com/section"; returns a
// normalized hostname or null when nothing hostname-like can be extracted.
export function normalizeSiteEntry(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  let hostname: string;
  try {
    hostname = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
  } catch {
    return null;
  }

  hostname = hostname.replace(STRIP_SUBDOMAINS, '');
  if (!hostname || !hostname.includes('.')) return null;
  return hostname;
}

// Suffix match so "nytimes.com" covers cooking.nytimes.com and www.nytimes.com.
// No public-suffix reduction: an entry is whatever the user added, so "co.uk"
// style apexes work because they are stored as e.g. "bbc.co.uk".
export function siteMatches(hostname: string, site: string): boolean {
  const host = hostname.toLowerCase();
  return host === site || host.endsWith(`.${site}`);
}

export function matchesAnySite(hostname: string, sites: string[]): boolean {
  return sites.some((site) => siteMatches(hostname, site));
}
