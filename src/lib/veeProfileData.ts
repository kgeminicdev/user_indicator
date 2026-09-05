// Server-side only. Looks up a LinkedIn profile via the locally-running Vee
// (Veezee) lookup service — never forward the response anywhere but this
// app's own UI.
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";

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

let proxyIpIndex = 0;
let proxyDispatcher: Dispatcher | undefined;

function getProxyDispatcher(): Dispatcher | undefined {
  if (VEE_PROXY_IP_LIST.length === 0 || !VEE_PROXY_USERNAME || !VEE_PROXY_PASSWORD) {
    return undefined;
  }

  if (!proxyDispatcher) {
    const ip = VEE_PROXY_IP_LIST[proxyIpIndex];
    proxyDispatcher = new ProxyAgent(
      `http://${VEE_PROXY_USERNAME}:${VEE_PROXY_PASSWORD}@${ip}`
    );
  }

  return proxyDispatcher;
}

// Round-robins to the next configured proxy IP and drops the cached
// dispatcher so the next request picks up the new one — used when the
// current IP has exhausted its per-IP daily free-tier credits.
function rotateProxyIp() {
  if (VEE_PROXY_IP_LIST.length === 0) return;
  proxyIpIndex = (proxyIpIndex + 1) % VEE_PROXY_IP_LIST.length;
  proxyDispatcher = undefined;
}

function getCurrentProxyIp(): string | null {
  return VEE_PROXY_IP_LIST[proxyIpIndex] ?? null;
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

async function veeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const dispatcher = getProxyDispatcher();
  if (!dispatcher) return fetch(input, init);

  // Node's global fetch and the npm `undici` package are separate instances
  // — handing the global fetch a Dispatcher built by this package's
  // ProxyAgent throws "invalid onRequestStart method" (UND_ERR_INVALID_ARG).
  // undici's own fetch must be used whenever a dispatcher is involved.
  return undiciFetch(
    input as string,
    { ...init, dispatcher } as Parameters<typeof undiciFetch>[1]
  ) as unknown as Promise<Response>;
}

export async function fetchVeeProfile(profileUrl: string): Promise<VeeProfileData> {
  const url = new URL(VEE_API_URL);
  url.searchParams.set("identifier", extractLinkedinIdentifier(profileUrl));
  url.searchParams.set("sections", VEE_SECTIONS);

  const headers: Record<string, string> = {};
  if (VEE_API_TOKEN) headers.Authorization = `Bearer ${VEE_API_TOKEN}`;

  let response: Response;
  try {
    response = await veeFetch(url.toString(), { headers });
  } catch (err) {
    throw new VeeProfileError(
      `Failed to reach Vee lookup service at ${VEE_API_URL}: ${(err as Error).message}`
    );
  }

  if (!response.ok) {
    throw new VeeProfileError(
      `Vee lookup service error: ${response.status} ${response.statusText}`
    );
  }

  try {
    return await response.json();
  } catch (err) {
    throw new VeeProfileError(
      `Vee lookup service returned invalid JSON: ${(err as Error).message}`
    );
  }
}

export async function fetchVeeUsage(): Promise<VeeUsage> {
  const headers: Record<string, string> = {};
  if (VEE_API_TOKEN) headers.Authorization = `Bearer ${VEE_API_TOKEN}`;

  let response: Response;
  try {
    response = await veeFetch(VEE_USAGE_URL, { headers });
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

  // This IP's daily free-tier credits are exhausted — rotate to the next
  // configured IP so the next call gets a fresh per-IP quota.
  if (remainingToday !== null && remainingToday <= 0) {
    rotateProxyIp();
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
    currentProxyIp: getCurrentProxyIp(),
    proxyIpCount: VEE_PROXY_IP_LIST.length,
  };
}
