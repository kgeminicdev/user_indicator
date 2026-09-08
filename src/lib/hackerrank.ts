// Server-side only. Talks to the local HackerRank relay. The leaderboard
// endpoint requires the session cookie (kept server-side, never forwarded to
// the client); the hacker profile endpoint is a plain, unauthenticated GET.
const HACKERRANK_API_URL = process.env.HACKERRANK_API_URL || "http://localhost:9000";
const HACKERRANK_COOKIE = process.env.HACKERRANK_COOKIE;

export class HackerRankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HackerRankError";
  }
}

export async function hackerrankFetch(
  path: string,
  params?: Record<string, string>,
  options?: { useCookie?: boolean }
): Promise<unknown> {
  const useCookie = options?.useCookie ?? true;
  if (useCookie && !HACKERRANK_COOKIE) {
    throw new HackerRankError("HACKERRANK_COOKIE is not set in the environment");
  }

  const url = new URL(`${HACKERRANK_API_URL}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers: Record<string, string> = {};
  if (useCookie && HACKERRANK_COOKIE) headers.Cookie = HACKERRANK_COOKIE;

  let response: Response;
  try {
    response = await fetch(url.toString(), { headers });
  } catch (err) {
    throw new HackerRankError(
      `Failed to reach HackerRank at ${HACKERRANK_API_URL}: ${(err as Error).message}`
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new HackerRankError(
      `HackerRank error: ${response.status} ${response.statusText} — ${body}`
    );
  }

  return response.json();
}
