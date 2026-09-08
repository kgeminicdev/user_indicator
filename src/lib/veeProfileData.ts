// Server-side only. Looks up a LinkedIn profile via the locally-running Vee
// (Veezee) lookup service — never forward the response anywhere but this
// app's own UI.
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { pool } from "@/lib/db";

const VEE_API_URL = process.env.VEE_API_URL + "linkedin/profiles" || "http://localhost:5000/profiles";
const VEE_USAGE_URL = process.env.VEE_API_URL + "usage" || "http://localhost:5001/usage";
// Sent as `Authorization: Bearer <token>` — put just the raw token in the
// env var, no "Bearer " prefix.
const VEE_API_TOKEN = process.env.VEE_API_TOKEN;
const VEE_SECTIONS = "experience,skills,about,education";

const VEE_PROXY_USERNAME = process.env.VEE_PROXY_USERNAME;
const VEE_PROXY_PASSWORD = process.env.VEE_PROXY_PASSWORD;
const VEE_PROXY_IP_LIST = (process.env.VEE_PROXY_IP_LIST ?? "")
  .split(",")
  .map((ip) => ip.trim())
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
  // Proxy-rotation state — just the host:port, never the embedded
  // credentials.
  currentProxyIp: string | null;
  proxyIpCount: number;
};

export class VeeProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VeeProfileError";
  }
}

const hasProxyConfig = VEE_PROXY_IP_LIST.length > 0 && !!VEE_PROXY_USERNAME && !!VEE_PROXY_PASSWORD;

// Proxy IPs periodically go stale/unreachable (the whole pool has been
// observed dead at once, not just individual entries) — without a timeout, a
// single hung proxy connection blocks the request indefinitely instead of
// failing over to the next candidate. Kept short since a live proxy connects
// almost instantly; this is purely a reachability check.
const VEE_PROXY_TIMEOUT_MS = 8000;

// The direct (non-proxied) attempt is the last resort, so it's given much
// more room — a fresh, not-yet-cached profile genuinely takes Vee a while to
// scrape, and cutting that off at the same short timeout used for weeding
// out dead proxies would fail a request that was actually working.
const VEE_DIRECT_TIMEOUT_MS = 45000;

// If the whole configured pool is down, trying all of them sequentially
// (even at 8s each) could take minutes. Cap how many proxy IPs get tried
// before falling back to a direct (non-proxied) request.
const MAX_PROXY_ATTEMPTS = 5;

const proxyDispatchers = new Map<string, Dispatcher>();

function getDispatcherForIp(ip: string): Dispatcher {
  let dispatcher = proxyDispatchers.get(ip);
  if (!dispatcher) {
    dispatcher = new ProxyAgent(`http://${VEE_PROXY_USERNAME}:${VEE_PROXY_PASSWORD}@${ip}`);
    proxyDispatchers.set(ip, dispatcher);
  }
  return dispatcher;
}

// The free tier resets daily — round to the next UTC midnight so a marked
// IP naturally becomes eligible again without any separate cleanup job.
function nextMidnightUtc(): Date {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

// Reads which of the configured IPs are currently known-exhausted (persisted
// in vee_proxy_ips, so this survives server restarts). Failing to reach the
// DB just means "treat nothing as known-exhausted" rather than blocking
// lookups outright.
async function loadExhaustedUntil(ips: string[]): Promise<Map<string, Date>> {
  if (ips.length === 0) return new Map();
  try {
    const result = await pool.query<{ ip: string; exhausted_until: Date | null }>(
      `SELECT ip, exhausted_until FROM vee_proxy_ips WHERE ip = ANY($1)`,
      [ips]
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

async function markIpExhausted(ip: string): Promise<void> {
  await pool
    .query(
      `INSERT INTO vee_proxy_ips (ip, exhausted_until, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (ip) DO UPDATE SET exhausted_until = EXCLUDED.exhausted_until, updated_at = now()`,
      [ip, nextMidnightUtc()]
    )
    .catch(() => {});
}

function todayUtcDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// The lookup service's daily free-tier cap, consistently observed as 200
// across every configured IP via /usage. Each real profile lookup reports
// exactly how many credits it charged (usage.credits_charged in the raw
// response) — tracking that running total here lets an IP be marked
// exhausted the instant it crosses the cap, instead of only discovering
// that later via a wasted request that comes back 403.
const CREDITS_PER_IP_PER_DAY = 200;

async function recordCreditsUsed(ip: string, creditsCharged: number): Promise<void> {
  if (!Number.isFinite(creditsCharged) || creditsCharged <= 0) return;
  const today = todayUtcDateStr();
  try {
    const result = await pool.query<{ credits_used_today: number }>(
      `INSERT INTO vee_proxy_ips (ip, credits_used_today, credits_used_date, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (ip) DO UPDATE SET
         credits_used_today = CASE
           WHEN vee_proxy_ips.credits_used_date = $3 THEN vee_proxy_ips.credits_used_today + $2
           ELSE $2
         END,
         credits_used_date = $3,
         updated_at = now()
       RETURNING credits_used_today`,
      [ip, creditsCharged, today]
    );
    const usedToday = result.rows[0]?.credits_used_today ?? 0;
    if (usedToday >= CREDITS_PER_IP_PER_DAY) {
      await markIpExhausted(ip);
    }
  } catch {
    // Best-effort bookkeeping only — never let this fail a lookup that
    // already succeeded.
  }
}

// Ordered list of IPs worth actually trying right now — known-exhausted ones
// (per the persisted skip-list) are filtered out so a request never pays for
// a live 403 round-trip against an IP we already know is dead today. Falls
// back to the full list if every IP is marked exhausted, since the
// persisted state could be stale (e.g. credits topped up off-cycle).
async function pickCandidateIps(): Promise<string[]> {
  if (VEE_PROXY_IP_LIST.length === 0) return [];
  const now = new Date();
  const exhaustedUntil = await loadExhaustedUntil(VEE_PROXY_IP_LIST);
  const live = VEE_PROXY_IP_LIST.filter((ip) => {
    const until = exhaustedUntil.get(ip);
    return !until || until <= now;
  });
  return live.length > 0 ? live : VEE_PROXY_IP_LIST;
}

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

async function veeFetch(
  input: string | URL,
  init: RequestInit = {},
  ip?: string
): Promise<Response> {
  // Proxied attempts only need to prove the IP is reachable, so they get the
  // short timeout; the direct fallback is where real scraping work actually
  // happens, so it gets much more room.
  const signal = AbortSignal.timeout(ip ? VEE_PROXY_TIMEOUT_MS : VEE_DIRECT_TIMEOUT_MS);

  if (!ip) return fetch(input, { ...init, signal });

  // Node's global fetch and the npm `undici` package are separate instances
  // — handing the global fetch a Dispatcher built by this package's
  // ProxyAgent throws "invalid onRequestStart method" (UND_ERR_INVALID_ARG).
  // undici's own fetch must be used whenever a dispatcher is involved.
  return undiciFetch(input as string, {
    ...init,
    signal,
    dispatcher: getDispatcherForIp(ip),
  } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

async function fetchVeeProfileOnce(identifier: string, ip?: string): Promise<Response> {
  const url = new URL(VEE_API_URL);
  url.searchParams.set("identifier", identifier);
  url.searchParams.set("sections", VEE_SECTIONS);

  const headers: Record<string, string> = {};
  if (VEE_API_TOKEN) headers.Authorization = `Bearer ${VEE_API_TOKEN}`;

  return veeFetch(url.toString(), { headers }, ip);
}

export async function fetchVeeProfile(profileUrl: string): Promise<VeeProfileData> {
  const identifier = extractLinkedinIdentifier(profileUrl);

  // A 403 means the proxy IP's daily free-tier credits are exhausted.
  // Candidates already known-exhausted (persisted in vee_proxy_ips) are
  // skipped up front instead of re-discovering that via a live 403 round
  // trip on every request — a fresh 403 here still marks the IP exhausted
  // so every later request (and every later server restart) skips it too.
  //
  // A final `undefined` candidate (direct, no proxy) is always appended when
  // proxies are configured — if the whole pool is unreachable (the entire
  // pool has been observed dead at once, not just individual IPs), the
  // server's own IP still has its own separate daily free-tier credits and
  // should be tried before giving up entirely.
  const candidates: (string | undefined)[] = hasProxyConfig
    ? [...(await pickCandidateIps()).slice(0, MAX_PROXY_ATTEMPTS), undefined]
    : [undefined];

  let response: Response | undefined;
  let lastError: VeeProfileError | undefined;
  let successIp: string | undefined;

  for (const ip of candidates) {
    try {
      response = await fetchVeeProfileOnce(identifier, ip);
    } catch (err) {
      lastError = new VeeProfileError(
        `Failed to reach Vee lookup service${ip ? ` via proxy ${ip}` : ""}: ${(err as Error).message}`
      );
      response = undefined;
      continue;
    }

    if (response.status === 403) {
      if (ip) await markIpExhausted(ip);
      response = undefined;
      continue;
    }
    successIp = ip;
    break;
  }

  if (!response) {
    throw (
      lastError ??
      new VeeProfileError(
        `All configured proxy IPs${hasProxyConfig ? " and the direct connection" : ""} are exhausted for today — try again after the daily reset.`
      )
    );
  }

  if (!response.ok) {
    throw new VeeProfileError(
      `Vee lookup service error: ${response.status} ${response.statusText}`
    );
  }

  let rawBody: VeeProfileData & { usage?: { credits_charged?: number } };
  try {
    rawBody = await response.json();
  } catch (err) {
    throw new VeeProfileError(
      `Vee lookup service returned invalid JSON: ${(err as Error).message}`
    );
  }

  // The raw response also reports how many credits this call charged
  // (usage.credits_charged) — track it per IP so exhaustion is predicted
  // proactively instead of only discovered via a later wasted request.
  if (successIp && typeof rawBody.usage?.credits_charged === "number") {
    await recordCreditsUsed(successIp, rawBody.usage.credits_charged);
  }

  // Never forward usage/freshness/billing metadata to the client — it
  // carries an upgrade link with an embedded account token, the same class
  // of sensitive data /usage's whitelist already excludes. Only the actual
  // profile content is returned.
  return {
    canonical_url: rawBody.canonical_url,
    data_as_of: rawBody.data_as_of,
    common: rawBody.common,
    platform_fields: rawBody.platform_fields,
  };
}

export async function fetchVeeUsage(): Promise<VeeUsage> {
  const headers: Record<string, string> = {};
  if (VEE_API_TOKEN) headers.Authorization = `Bearer ${VEE_API_TOKEN}`;

  // Report usage for whichever IP a profile lookup would actually try next
  // (the first non-known-exhausted candidate), so this reflects reality
  // instead of a stale single "current" pointer.
  const candidates = hasProxyConfig ? await pickCandidateIps() : [];
  const ip = candidates[0];

  let response: Response;
  try {
    response = await veeFetch(VEE_USAGE_URL, { headers }, ip);
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

  // This IP's daily free-tier credits are exhausted — mark it so the next
  // profile lookup (and the next usage check) skips it without needing to
  // discover that itself via a live 403.
  if (ip && remainingToday !== null && remainingToday <= 0) {
    await markIpExhausted(ip);
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
    currentProxyIp: ip ?? null,
    proxyIpCount: VEE_PROXY_IP_LIST.length,
  };
}
