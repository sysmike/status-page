// Reads monitor and site configuration out of GitHub Actions variables.
//
// Every monitor is its own repository variable named MONITOR_<SLUG>. The value
// is either a bare URL or a JSON object with per-monitor options.

const MONITOR_PREFIX = 'MONITOR_';

const DEFAULTS = {
  method: 'GET',
  timeout: 10000,
  retries: 1,
  degradedMs: 0,
  expectedStatus: '2xx',
  followRedirects: true,
};

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleize(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function parseValue(name, raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      throw new Error(`Variable ${name} is not valid JSON: ${error.message}`);
    }
  }
  return { url: trimmed };
}

function normalizeExpected(expected) {
  const list = Array.isArray(expected) ? expected : [expected];
  return list.map((entry) => String(entry).toLowerCase());
}

export function statusMatches(code, expected) {
  return normalizeExpected(expected).some((pattern) => {
    if (/^\d{3}$/.test(pattern)) return Number(pattern) === code;
    if (/^\dxx$/.test(pattern)) return Math.floor(code / 100) === Number(pattern[0]);
    if (pattern.includes('-')) {
      const [low, high] = pattern.split('-').map(Number);
      return code >= low && code <= high;
    }
    return false;
  });
}

// `vars` is the JSON serialization of the Actions `vars` context.
export function loadConfig(varsJson) {
  const vars = JSON.parse(varsJson || '{}');
  const monitors = [];

  for (const [name, raw] of Object.entries(vars)) {
    if (!name.startsWith(MONITOR_PREFIX)) continue;
    const parsed = parseValue(name, raw);
    if (!parsed) continue;
    if (!parsed.url) throw new Error(`Variable ${name} has no url`);

    const slug = slugify(parsed.slug || name.slice(MONITOR_PREFIX.length));
    monitors.push({
      ...DEFAULTS,
      ...parsed,
      slug,
      name: parsed.name || titleize(slug),
      method: String(parsed.method || DEFAULTS.method).toUpperCase(),
      group: parsed.group || null,
      description: parsed.description || null,
      headers: parsed.headers || {},
      link: parsed.link || null,
    });
  }

  monitors.sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name));

  const site = {
    title: vars.SITE_TITLE || 'Status',
    description: vars.SITE_DESCRIPTION || '',
    link: vars.SITE_LINK || '',
    logo: vars.SITE_LOGO || '',
    theme: vars.SITE_THEME === 'light' ? 'light' : vars.SITE_THEME === 'dark' ? 'dark' : 'auto',
  };

  const incidents = {
    threshold: Number(vars.INCIDENT_THRESHOLD || 2),
    labels: (vars.INCIDENT_LABELS || 'status,incident')
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean),
  };

  return { site, monitors, incidents };
}
