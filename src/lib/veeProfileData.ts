// Server-side only. Looks up a LinkedIn profile via the locally-running Vee
// (Veezee) lookup service — never forward the response anywhere but this
// app's own UI.
import { ProxyAgent, fetch as undiciFetch } from "undici";

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

// A single Webshare "rotating" gateway endpoint (host:port, e.g.
// p.webshare.io:80), tried after the static list — Webshare assigns a
// different backend exit IP per fresh connection through this one endpoint,
// so it's a useful fallback when the static list above is having a bad day.
const VEE_PROXY_USERNAME = process.env.VEE_PROXY_USERNAME;
const VEE_PROXY_PASSWORD = process.env.VEE_PROXY_PASSWORD;
const VEE_PROXY_ROTATING_HOST = process.env.VEE_PROXY_ROTATING_HOST;
const ROTATING_PROXY_AUTHORITY =
  VEE_PROXY_USERNAME && VEE_PROXY_PASSWORD && VEE_PROXY_ROTATING_HOST
    ? `${VEE_PROXY_USERNAME}:${VEE_PROXY_PASSWORD}@${VEE_PROXY_ROTATING_HOST}`
    : null;

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

const hasProxyConfig = VEE_PROXY_LIST.length > 0 || ROTATING_PROXY_AUTHORITY !== null;

// Each proxy attempt (static list entry or a rotating-gateway connection)
// only needs to prove that IP is reachable and has credits, so it gets a
// short timeout — a live proxy connects almost instantly. The direct
// (non-proxied) attempt is the true last resort and gets much more room: a
// fresh, not-yet-cached profile genuinely takes Vee a while to scrape, and
// cutting that off at the same short timeout would fail a request that was
// actually working.
const VEE_PROXY_TIMEOUT_MS = 8000;
const VEE_DIRECT_TIMEOUT_MS = 45000;

// Bounds worst-case latency when a whole tier is having a bad day (this has
// happened — the entire static list, and separately the entire rotating
// pool, have each been observed fully exhausted/unreachable at once).
const MAX_LIST_ATTEMPTS = 8;
const MAX_ROTATING_ATTEMPTS = 5;

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

// A fresh ProxyAgent (and thus a fresh TCP connection) per attempt matters
// most for the rotating gateway — reusing one connection keeps the same
// exit IP for as long as it stays alive, defeating rotation — but building
// one per call uniformly here also keeps this function simple for static
// list entries. The response body is read and rebuffered into a plain
// Response before the agent is closed, so closing it right after doesn't
// risk cutting off a body the caller hasn't read yet.
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
  const url = new URL(VEE_API_URL);
  url.searchParams.set("identifier", identifier);
  url.searchParams.set("sections", VEE_SECTIONS);
  const headers = buildHeaders();

  // Static list entries first (each already known to be a real proxy
  // server), then the rotating gateway as a second tier — each rotating
  // attempt is a fresh connection, so repeating the same authority string
  // still tries a different exit IP each time.
  const proxyCandidates: string[] = [
    ...VEE_PROXY_LIST.slice(0, MAX_LIST_ATTEMPTS),
    ...(ROTATING_PROXY_AUTHORITY ? Array(MAX_ROTATING_ATTEMPTS).fill(ROTATING_PROXY_AUTHORITY) : []),
  ];

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
    if (response && response.status === 403) response = undefined;
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
  return {
    canonical_url: rawBody.canonical_url,
    data_as_of: rawBody.data_as_of,
    common: rawBody.common,
    platform_fields: rawBody.platform_fields,
  };
}

export async function fetchVeeUsage(): Promise<VeeUsage> {
  const headers = buildHeaders();

  // Just reports whichever endpoint would be tried first for a real lookup
  // — with a static list configured that's its first entry, otherwise the
  // rotating gateway, otherwise direct.
  const authority = VEE_PROXY_LIST[0] ?? ROTATING_PROXY_AUTHORITY ?? null;

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
    // Strip credentials — only the host:port (plus a "(rotating)" suffix
    // when applicable) is ever reported to the client.
    currentProxyIp: authority
      ? `${authority.split("@").pop()}${authority === ROTATING_PROXY_AUTHORITY ? " (rotating)" : ""}`
      : null,
    proxyIpCount: VEE_PROXY_LIST.length,
  };
}
