// Server-side only. Looks up a LinkedIn profile via the locally-running Vee
// (Veezee) lookup service — never forward the response anywhere but this
// app's own UI.
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { pool } from "@/lib/db";

const VEE_API_URL = process.env.VEE_API_URL + "linkedin/profiles" || "http://localhost:5000/profiles";
const VEE_USAGE_URL = process.env.VEE_API_URL + "usage" || "http://localhost:5001/usage";
// Sent as `Authorization: Bearer <token>` — put just the raw token in the
// env var, no "Bearer " prefix.
const VEE_API_TOKEN = process.env.VEE_API_TOKEN;
const VEE_SECTIONS = "experience,skills,about,education";

// Static candidate proxies, each a self-contained "username:password@host:port"
// authority string — supports multiple credential sets against the same (or
// overlapping) IPs, e.g. two separate Webshare sub-users sharing one IP pool.
const VEE_PROXY_LIST = (process.env.VEE_PROXY_LIST ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

// Mirrors the lookup service's response shape 1:1 (snake_case, as returned)
// — deliberately excludes the `usage`/`freshness` fields, which carry
// account/billing details (including an upgrade link with an embedded
// token), not profile content.
export type VeeMonthYear = { month: number | null; year: number | null };

export type VeePosition = {
  role: string;
  location: string | null;
  is_current: boolean;
  start_date: VeeMonthYear;
  end_date: VeeMonthYear;
};

export type VeeExperience = {
  company: { name: string; handle: string | null; url: string | null };
  positions: VeePosition[];
};

export type VeeEducation = {
  institution: string;
  institution_url: string | null;
  degree: string | null;
  start_year: number | null;
  end_year: number | null;
};

export type VeeSkill = {
  name: string;
  endorsement_count: number;
};

export type VeeProfileData = {
  canonical_url: string;
  data_as_of: string | null;
  common: {
    full_name: string;
    headline: string | null;
    location: { name: string | null; country_code: string | null } | null;
    about: string | null;
    current_position: {
      company_name: string | null;
      company_url: string | null;
      start_year: number | null;
    } | null;
    experience: VeeExperience[];
    education: VeeEducation[];
    skills: VeeSkill[];
    followers: number | null;
    connections: number | null;
    is_verified: boolean;
    image_url: string | null;
    url: string;
  };
  platform_fields: {
    public_identifier: string | null;
    is_hiring: boolean;
    pronoun: string | null;
  };
};

// Deliberately a hand-picked subset of the /usage response — that response
// also carries claim_url/upgrade_url/manage_url with embedded account
// tokens, which must never reach the client. Only these plain usage numbers
// are extracted; everything else from the raw response is discarded here,
// on the server, before it could ever be serialized into an API response.
export type VeeUsage = {
  plan: string | null;
  platforms: string[];
  balanceRemaining: number | null;
  freeTier: {
    creditsPerIpDay: number | null;
    usedToday: number | null;
    remainingToday: number | null;
    resets: string | null;
  } | null;
  realtimeOpsUsed: number | null;
  realtimeOpsLimit: number | null;
  concurrentLimit: number | null;
  // Which endpoint this usage reading came through — a host:port (never the
  // embedded credentials) or null if fetched directly.
  currentProxyIp: string | null;
  proxyIpCount: number;
};

export class VeeProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VeeProfileError";
  }
}

const hasProxyConfig = VEE_PROXY_LIST.length > 0;

// Each proxy attempt only needs to prove that IP is reachable and has
// credits, so it gets a short timeout — a live proxy connects almost
// instantly. The direct (non-proxied) attempt is the true last resort and
// gets much more room: a fresh, not-yet-cached profile genuinely takes Vee
// a while to scrape, and cutting that off at the same short timeout would
// fail a request that was actually working.
const VEE_PROXY_TIMEOUT_MS = 8000;
const VEE_DIRECT_TIMEOUT_MS = 45000;

// Bounds worst-case latency when the whole list is having a bad day (this
// has happened — the entire static list has been observed fully
// exhausted/unreachable at once). 10 paid Webshare entries (100% reliable
// across every check run) plus 3 free proxies that each passed 4/4 live
// test rounds against Vee specifically, added as lower-priority fallback.
const MAX_LIST_ATTEMPTS = 13;

// The lookup service expects just the profile slug (e.g.
// "lukas-steiblys-4583561a"), not the full profile URL — sending the full
// URL as `identifier` hits a different cache key upstream and can return
// stale/wrong data. Accepts either form so a pasted full URL still works.
function extractLinkedinIdentifier(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return trimmed;
    const segments = url.pathname.split("/").filter(Boolean);
    const inIndex = segments.indexOf("in");
    if (inIndex !== -1 && segments[inIndex + 1]) return segments[inIndex + 1];
    return segments[segments.length - 1] ?? trimmed;
  } catch {
    return trimmed;
  }
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (VEE_API_TOKEN) headers.Authorization = `Bearer ${VEE_API_TOKEN}`;
  return headers;
}

// Credentials never leave this module past this point — every candidate is
// tracked and reported by its host:port alone.
function hostPortOf(authority: string): string {
  return authority.split("@").pop() ?? authority;
}

// The free tier resets daily — round to the next UTC midnight so a marked
// entry naturally becomes eligible again without any separate cleanup job.
function nextMidnightUtc(): Date {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

// Reads which configured entries are currently known-exhausted (persisted in
// vee_proxy_ips, so this survives server restarts and — critically — is
// shared across every request today instead of every request rediscovering
// the same exhausted entries from scratch via a live 403. Credit usage
// across a list this size is never even: whichever entries happen to be
// tried first burn through their daily cap first, and without this, every
// later request keeps re-paying the cost of testing them anyway. Failing to
// reach the DB just means "treat nothing as known-exhausted" rather than
// blocking lookups outright.
async function loadExhaustedUntil(hostPorts: string[]): Promise<Map<string, Date>> {
  if (hostPorts.length === 0) return new Map();
  try {
    const result = await pool.query<{ ip: string; exhausted_until: Date | null }>(
      `SELECT ip, exhausted_until FROM vee_proxy_ips WHERE ip = ANY($1)`,
      [hostPorts]
    );
    const map = new Map<string, Date>();
    for (const row of result.rows) {
      if (row.exhausted_until) map.set(row.ip, new Date(row.exhausted_until));
    }
    return map;
  } catch {
    return new Map();
  }
}

async function markExhausted(hostPort: string): Promise<void> {
  await pool
    .query(
      `INSERT INTO vee_proxy_ips (ip, exhausted_until, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (ip) DO UPDATE SET exhausted_until = EXCLUDED.exhausted_until, updated_at = now()`,
      [hostPort, nextMidnightUtc()]
    )
    .catch(() => {});
}

// LinkedIn profiles don't meaningfully change hour to hour, so a fetch is
// reused for a month before it's considered stale enough to re-spend a
// credit on. This is what actually stops "View" and "Get content" (or the
// background refill job) from each paying for the same person separately.
const PROFILE_CACHE_TTL_DAYS = 30;

async function loadCachedProfile(identifier: string): Promise<VeeProfileData | null> {
  try {
    const result = await pool.query<{ data: VeeProfileData; fetched_at: Date }>(
      `SELECT data, fetched_at FROM vee_profile_cache WHERE identifier = $1`,
      [identifier]
    );
    const row = result.rows[0];
    if (!row) return null;
    const ageMs = Date.now() - new Date(row.fetched_at).getTime();
    if (ageMs > PROFILE_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) return null;
    return row.data;
  } catch {
    return null;
  }
}

async function saveCachedProfile(identifier: string, data: VeeProfileData): Promise<void> {
  await pool
    .query(
      `INSERT INTO vee_profile_cache (identifier, data, fetched_at)
       VALUES ($1, $2, now())
       ON CONFLICT (identifier) DO UPDATE SET data = EXCLUDED.data, fetched_at = now()`,
      [identifier, JSON.stringify(data)]
    )
    .catch(() => {});
}

// Ordered candidates worth actually trying right now — entries already
// known-exhausted today are skipped so a request never pays to rediscover
// that live. Falls back to the full list if every entry is marked
// exhausted, since the persisted state could be stale (e.g. credits topped
// up off-cycle, or a previous day's marks not yet expired).
async function pickCandidates(): Promise<string[]> {
  if (VEE_PROXY_LIST.length === 0) return [];
  const now = new Date();
  const exhaustedUntil = await loadExhaustedUntil(VEE_PROXY_LIST.map(hostPortOf));
  const live = VEE_PROXY_LIST.filter((authority) => {
    const until = exhaustedUntil.get(hostPortOf(authority));
    return !until || until <= now;
  });
  return live.length > 0 ? live : VEE_PROXY_LIST;
}

// The response body is read and rebuffered into a plain Response before the
// agent is closed, so closing it right after the fetch resolves doesn't risk
// cutting off a body the caller hasn't read yet.
async function fetchViaProxy(
  url: string,
  headers: Record<string, string>,
  authority: string
): Promise<Response> {
  const dispatcher = new ProxyAgent(`http://${authority}`);
  const signal = AbortSignal.timeout(VEE_PROXY_TIMEOUT_MS);
  try {
    const raw = (await undiciFetch(url, {
      headers,
      signal,
      dispatcher,
    } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
    const text = await raw.text();
    return new Response(text, { status: raw.status, statusText: raw.statusText });
  } finally {
    dispatcher.close().catch(() => {});
  }
}

async function fetchDirect(url: string, headers: Record<string, string>): Promise<Response> {
  const signal = AbortSignal.timeout(VEE_DIRECT_TIMEOUT_MS);
  return fetch(url, { headers, signal });
}

export async function fetchVeeProfile(profileUrl: string): Promise<VeeProfileData> {
  const identifier = extractLinkedinIdentifier(profileUrl);

  const cached = await loadCachedProfile(identifier);
  if (cached) return cached;

  const url = new URL(VEE_API_URL);
  url.searchParams.set("identifier", identifier);
  url.searchParams.set("sections", VEE_SECTIONS);
  const headers = buildHeaders();

  const proxyCandidates: string[] = (await pickCandidates()).slice(0, MAX_LIST_ATTEMPTS);

  let response: Response | undefined;
  let lastError: VeeProfileError | undefined;

  for (const authority of proxyCandidates) {
    try {
      response = await fetchViaProxy(url.toString(), headers, authority);
    } catch (err) {
      lastError = new VeeProfileError(
        `Failed to reach Vee lookup service via proxy: ${(err as Error).message}`
      );
      response = undefined;
      continue;
    }

    if (response.status === 403) {
      await markExhausted(hostPortOf(authority));
      response = undefined;
      continue;
    }
    break;
  }

  // Every proxy attempt failed (or none were configured) — the server's own
  // IP has its own separate daily free-tier credits and is worth trying
  // before giving up entirely.
  if (!response) {
    try {
      response = await fetchDirect(url.toString(), headers);
    } catch (err) {
      lastError = new VeeProfileError(
        `Failed to reach Vee lookup service directly: ${(err as Error).message}`
      );
      response = undefined;
    }
    if (response && response.status === 403) {
      response = undefined;
      // The true final reason is exhaustion, not whatever unrelated proxy
      // error happened earlier in the loop — clear it so the generic
      // exhaustion message below is shown instead of a stale, misleading
      // one (e.g. "via proxy: timeout" when the actual blocker is that
      // every avenue, direct included, is simply out of credits today).
      lastError = undefined;
    }
  }

  if (!response) {
    throw (
      lastError ??
      new VeeProfileError(
        `All configured proxies${hasProxyConfig ? " and the direct connection" : ""} came back exhausted for today — try again after the daily reset.`
      )
    );
  }

  if (!response.ok) {
    throw new VeeProfileError(
      `Vee lookup service error: ${response.status} ${response.statusText}`
    );
  }

  let rawBody: VeeProfileData;
  try {
    rawBody = await response.json();
  } catch (err) {
    throw new VeeProfileError(
      `Vee lookup service returned invalid JSON: ${(err as Error).message}`
    );
  }

  // Never forward usage/freshness/billing metadata to the client — it
  // carries an upgrade link with an embedded account token, the same class
  // of sensitive data /usage's whitelist already excludes. Only the actual
  // profile content is returned.
  const profile: VeeProfileData = {
    canonical_url: rawBody.canonical_url,
    data_as_of: rawBody.data_as_of,
    common: rawBody.common,
    platform_fields: rawBody.platform_fields,
  };
  await saveCachedProfile(identifier, profile);
  return profile;
}

export async function fetchVeeUsage(): Promise<VeeUsage> {
  const headers = buildHeaders();

  // Just reports whichever endpoint would be tried first for a real lookup
  // — the first non-known-exhausted proxy, otherwise direct.
  const candidates = await pickCandidates();
  const authority = candidates[0] ?? null;

  let response: Response;
  try {
    response = authority
      ? await fetchViaProxy(VEE_USAGE_URL, headers, authority)
      : await fetchDirect(VEE_USAGE_URL, headers);
  } catch (err) {
    throw new VeeProfileError(
      `Failed to reach Vee usage endpoint at ${VEE_USAGE_URL}: ${(err as Error).message}`
    );
  }

  if (!response.ok) {
    throw new VeeProfileError(
      `Vee usage endpoint error: ${response.status} ${response.statusText}`
    );
  }

  let body: { common?: Record<string, unknown> };
  try {
    body = await response.json();
  } catch (err) {
    throw new VeeProfileError(
      `Vee usage endpoint returned invalid JSON: ${(err as Error).message}`
    );
  }

  const common = body.common ?? {};
  const freeTier = common.free_tier as Record<string, unknown> | undefined;
  const remainingToday =
    freeTier && typeof freeTier.remaining_today === "number" ? freeTier.remaining_today : null;

  // This entry's daily credits are exhausted — mark it now so the next
  // profile lookup (and the next usage check) skips it without needing to
  // discover that itself via a live 403.
  if (authority && remainingToday !== null && remainingToday <= 0) {
    await markExhausted(hostPortOf(authority));
  }

  return {
    plan: typeof common.plan === "string" ? common.plan : null,
    platforms: Array.isArray(common.platforms) ? (common.platforms as string[]) : [],
    balanceRemaining:
      typeof common.balance_remaining === "number" ? common.balance_remaining : null,
    freeTier: freeTier
      ? {
          creditsPerIpDay:
            typeof freeTier.credits_per_ip_day === "number"
              ? freeTier.credits_per_ip_day
              : null,
          usedToday: typeof freeTier.used_today === "number" ? freeTier.used_today : null,
          remainingToday,
          resets: typeof freeTier.resets === "string" ? freeTier.resets : null,
        }
      : null,
    realtimeOpsUsed:
      typeof common.realtime_ops_used === "number" ? common.realtime_ops_used : null,
    realtimeOpsLimit:
      typeof common.realtime_ops_limit === "number" ? common.realtime_ops_limit : null,
    concurrentLimit:
      typeof common.concurrent_limit === "number" ? common.concurrent_limit : null,
    // Strip credentials — only the host:port is ever reported to the client.
    currentProxyIp: authority ? authority.split("@").pop() ?? null : null,
    proxyIpCount: VEE_PROXY_LIST.length,
  };
}
