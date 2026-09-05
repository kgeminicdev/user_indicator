const NOREPLY_DOMAIN = "users.noreply.github.com";
const BOT_NOREPLY_EMAIL = "noreply@github.com";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

export function isRealEmail(email: string | null | undefined): email is string {
  return Boolean(email) && !email!.endsWith(NOREPLY_DOMAIN) && email !== BOT_NOREPLY_EMAIL;
}

export class GithubRateLimitError extends Error {
  resetAt: Date;
  constructor(resetAt: Date) {
    super(`GitHub API rate limit exceeded. Resets at ${resetAt.toLocaleString()}.`);
    this.name = "GithubRateLimitError";
    this.resetAt = resetAt;
  }
}

function throwIfRateLimited(response: Response): never | void {
  if (
    (response.status === 403 || response.status === 429) &&
    response.headers.get("x-ratelimit-remaining") === "0"
  ) {
    const resetHeader = response.headers.get("x-ratelimit-reset");
    const resetAt = resetHeader
      ? new Date(Number(resetHeader) * 1000)
      : new Date(Date.now() + 60 * 60 * 1000);
    throw new GithubRateLimitError(resetAt);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson(url: string) {
  const headers: Record<string, string> = GITHUB_TOKEN
    ? { Authorization: `token ${GITHUB_TOKEN}` }
    : {};
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throwIfRateLimited(response);
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  // The general API allows 5,000 req/hour — generous, but a large scan can
  // still approach it. Back off proactively rather than let the next call fail.
  const remaining = response.headers.get("x-ratelimit-remaining");
  const resetHeader = response.headers.get("x-ratelimit-reset");
  if (remaining !== null && Number(remaining) <= 5 && resetHeader) {
    const resetAt = new Date(Number(resetHeader) * 1000);
    await sleep(Math.max(0, resetAt.getTime() - Date.now()) + 1000);
  }

  return response.json();
}

export function extractGithubUsername(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("github.com")) return null;
    const [username] = parsed.pathname.split("/").filter(Boolean);
    return username || null;
  } catch {
    return null;
  }
}

export type GithubProfile = {
  name: string | null;
  location: string | null;
  email: string | null;
  blog: string | null;
};

export async function fetchGithubProfile(username: string): Promise<GithubProfile> {
  const profile = await fetchJson(`https://api.github.com/users/${username}`);
  return {
    name: profile.name ?? null,
    location: profile.location ?? null,
    email: profile.email ?? null,
    blog: profile.blog ?? null,
  };
}

type SocialAccount = { provider: string; url: string };

// Format check only — confirms the string is a well-formed LinkedIn profile
// URL (e.g. linkedin.com/in/some-slug). Does not verify the profile exists.
export function isValidLinkedinUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return false;
    return /^\/in\/[^/]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}

// Rare in practice — most GitHub users don't link LinkedIn anywhere on their
// profile. Checks both the dedicated "Social accounts" feature and the
// website/blog field, in case someone put their LinkedIn URL there instead.
export async function findLinkedinUrl(
  username: string,
  blog: string | null
): Promise<string | null> {
  if (blog && isValidLinkedinUrl(blog)) return blog;

  const accounts: SocialAccount[] = await fetchJson(
    `https://api.github.com/users/${username}/social_accounts`
  ).catch(() => []);
  const linkedin = accounts.find(
    (a) => a.provider?.toLowerCase() === "linkedin" && isValidLinkedinUrl(a.url)
  );
  return linkedin?.url ?? null;
}

// Cheap activity signal: GitHub already returns each repo's last-push date
// in the repo list itself, so the most recent one (sorted server-side) tells
// us when this person last pushed code — no extra API call beyond what a
// repo listing already costs.
export async function fetchMostRecentPushDate(username: string): Promise<string | null> {
  const repos: { pushed_at?: string }[] = await fetchJson(
    `https://api.github.com/users/${username}/repos?sort=pushed&direction=desc&per_page=1`
  );
  return repos[0]?.pushed_at ?? null;
}

type Repo = { full_name: string };
type Commit = { commit: { committer: { email: string } } };

export async function findRealCommitterEmail(username: string): Promise<string | null> {
  const repos: Repo[] = await fetchJson(
    `https://api.github.com/users/${username}/repos?sort=pushed&direction=desc&per_page=100`
  );
  if (!Array.isArray(repos) || repos.length === 0) return null;

  for (const repo of repos.slice(0, 10)) {
    const commits: Commit[] = await fetchJson(
      `https://api.github.com/repos/${repo.full_name}/commits?author=${username}&per_page=30`
    ).catch((err) => {
      if (err instanceof GithubRateLimitError) throw err;
      return [];
    });
    for (const commit of commits) {
      const email = commit.commit.committer.email;
      if (isRealEmail(email)) return email;
    }
  }
  return null;
}
