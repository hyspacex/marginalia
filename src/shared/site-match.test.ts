import { matchesAnySite, normalizeSiteEntry, siteMatches } from './site-match';

describe('normalizeSiteEntry', () => {
  test('accepts full URLs and bare hostnames', () => {
    expect(normalizeSiteEntry('https://www.nytimes.com/section/politics')).toBe('nytimes.com');
    expect(normalizeSiteEntry('nytimes.com')).toBe('nytimes.com');
    expect(normalizeSiteEntry('NYTimes.com')).toBe('nytimes.com');
  });

  test('strips www, m, and amp prefixes', () => {
    expect(normalizeSiteEntry('www.nytimes.com')).toBe('nytimes.com');
    expect(normalizeSiteEntry('m.nytimes.com')).toBe('nytimes.com');
    expect(normalizeSiteEntry('amp.theguardian.com')).toBe('theguardian.com');
  });

  test('keeps meaningful subdomains and multi-label apexes', () => {
    expect(normalizeSiteEntry('cooking.nytimes.com')).toBe('cooking.nytimes.com');
    expect(normalizeSiteEntry('bbc.co.uk')).toBe('bbc.co.uk');
  });

  test('rejects invalid input', () => {
    expect(normalizeSiteEntry('')).toBeNull();
    expect(normalizeSiteEntry('   ')).toBeNull();
    expect(normalizeSiteEntry('invalid')).toBeNull();
    expect(normalizeSiteEntry('not a domain')).toBeNull();
  });
});

describe('siteMatches', () => {
  test('matches exact host and subdomains', () => {
    expect(siteMatches('nytimes.com', 'nytimes.com')).toBe(true);
    expect(siteMatches('www.nytimes.com', 'nytimes.com')).toBe(true);
    expect(siteMatches('cooking.nytimes.com', 'nytimes.com')).toBe(true);
  });

  test('does not match lookalike suffixes', () => {
    expect(siteMatches('notnytimes.com', 'nytimes.com')).toBe(false);
    expect(siteMatches('nytimes.com.evil.net', 'nytimes.com')).toBe(false);
  });

  test('works with multi-label apexes', () => {
    expect(siteMatches('news.bbc.co.uk', 'bbc.co.uk')).toBe(true);
    expect(siteMatches('bbc.co.uk', 'bbc.co.uk')).toBe(true);
  });
});

describe('matchesAnySite', () => {
  test('checks the hostname against every entry', () => {
    expect(matchesAnySite('www.nytimes.com', ['theguardian.com', 'nytimes.com'])).toBe(true);
    expect(matchesAnySite('example.com', ['theguardian.com', 'nytimes.com'])).toBe(false);
    expect(matchesAnySite('example.com', [])).toBe(false);
  });
});
