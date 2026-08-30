import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { braintrustPool } from "@/lib/braintrustDb";

const NOREPLY_DOMAIN = "users.noreply.github.com";
const BOT_NOREPLY_EMAIL = "noreply@github.com";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_CONCURRENCY = 5;

function isRealEmail(email: string | null | undefined): email is string {
  return Boolean(email) && !email!.endsWith(NOREPLY_DOMAIN) && email !== BOT_NOREPLY_EMAIL;
}

async function fetchJson(url: string) {
  const headers: Record<string, string> = GITHUB_TOKEN
    ? { Authorization: `token ${GITHUB_TOKEN}` }
    : {};
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function extractGithubUsername(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("github.com")) return null;
    const [username] = parsed.pathname.split("/").filter(Boolean);
    return username || null;
  } catch {
    return null;
  }
}

type Repo = { full_name: string };
type Commit = { commit: { committer: { email: string } } };

async function findRealCommitterEmail(username: string): Promise<string | null> {
  const repos: Repo[] = await fetchJson(
    `https://api.github.com/users/${username}/repos?sort=pushed&direction=desc&per_page=100`
  );
  if (!Array.isArray(repos) || repos.length === 0) return null;

  for (const repo of repos.slice(0, 10)) {
    const commits: Commit[] = await fetchJson(
      `https://api.github.com/repos/${repo.full_name}/commits?author=${username}&per_page=30`
    ).catch(() => []);
    for (const commit of commits) {
      const email = commit.commit.committer.email;
      if (isRealEmail(email)) return email;
    }
  }
  return null;
}

type ExternalProfile = { site: { name: string }; public_url: string };
type Candidate = {
  id: number;
  publicName: string | null;
  externalProfiles: ExternalProfile[];
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const startId = Number(body.startId);
  const endId = Number(body.endId);

  if (!Number.isFinite(startId) || !Number.isFinite(endId) || startId > endId) {
    return NextResponse.json(
      { error: "Provide a valid startId and endId (startId <= endId)" },
      { status: 400 }
    );
  }

  const { rows: candidates } = await braintrustPool.query<Candidate>(
    `
      SELECT id, "publicName", data->'external_profiles' AS "externalProfiles"
      FROM "Freelancer"
      WHERE id BETWEEN $1 AND $2
        AND title = 'Engineering'
        AND jsonb_array_length(data->'external_profiles') > 0
      ORDER BY id ASC
    `,
    [startId, endId]
  );

  const { rows: existing } = await pool.query(
    `SELECT email, link FROM records`
  );
  const existingLinks = new Set(existing.map((r) => r.link).filter(Boolean));
  const existingEmails = new Set(
    existing.map((r) => (r.email || "").toLowerCase()).filter(Boolean)
  );

  type Result = {
    braintrustId: number;
    name: string | null;
    githubUrl: string | null;
    linkedinUrl: string | null;
    derivedEmail: string | null;
    matched: boolean;
  };

  const results: Result[] = [];

  for (let start = 0; start < candidates.length; start += GITHUB_CONCURRENCY) {
    const batch = candidates.slice(start, start + GITHUB_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (candidate): Promise<Result> => {
        const profiles = candidate.externalProfiles || [];
        const github = profiles.find((p) => p.site?.name === "GitHub");
        const linkedin = profiles.find((p) => p.site?.name === "LinkedIn");

        if (github && existingLinks.has(github.public_url)) {
          return {
            braintrustId: candidate.id,
            name: candidate.publicName,
            githubUrl: github.public_url,
            linkedinUrl: linkedin?.public_url ?? null,
            derivedEmail: null,
            matched: true,
          };
        }
        if (linkedin && existingLinks.has(linkedin.public_url)) {
          return {
            braintrustId: candidate.id,
            name: candidate.publicName,
            githubUrl: github?.public_url ?? null,
            linkedinUrl: linkedin.public_url,
            derivedEmail: null,
            matched: true,
          };
        }

        let derivedEmail: string | null = null;
        if (github) {
          const username = extractGithubUsername(github.public_url);
          if (username) {
            derivedEmail = await findRealCommitterEmail(username).catch(() => null);
          }
        }
        const matched = Boolean(
          derivedEmail && existingEmails.has(derivedEmail.toLowerCase())
        );

        return {
          braintrustId: candidate.id,
          name: candidate.publicName,
          githubUrl: github?.public_url ?? null,
          linkedinUrl: linkedin?.public_url ?? null,
          derivedEmail,
          matched,
        };
      })
    );
    results.push(...batchResults);
  }

  const missing = results.filter((r) => !r.matched);

  let newlyQueued = 0;
  for (const r of missing) {
    const insertResult = await pool.query(
      `INSERT INTO todo (braintrust_id, name, github_url, linkedin_url, derived_email)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (braintrust_id) DO NOTHING`,
      [r.braintrustId, r.name, r.githubUrl, r.linkedinUrl, r.derivedEmail]
    );
    newlyQueued += insertResult.rowCount ?? 0;
  }

  return NextResponse.json({
    scanned: results.length,
    alreadyMatched: results.length - missing.length,
    missing: missing.length,
    newlyQueued,
    alreadyQueued: missing.length - newlyQueued,
  });
}
