import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { braintrustPool } from "@/lib/braintrustDb";
import { extractGithubUsername, findRealCommitterEmail } from "@/lib/githubEmail";
import { verifyLinkedinUrl } from "@/lib/linkedinVerify";
import { BRAINTRUST_FILTER } from "@/lib/braintrustFilter";

const GITHUB_CONCURRENCY = 5;

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
        AND ${BRAINTRUST_FILTER}
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
    linkedinVerified: boolean | null;
    externalProfiles: ExternalProfile[];
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

        // Match against ANY of the candidate's external links, not just
        // GitHub/LinkedIn — a match on any of them means we already have
        // this person.
        let linkedinVerified: boolean | null = null;
        if (linkedin) {
          linkedinVerified = await verifyLinkedinUrl(linkedin.public_url)
            .then((r) => r.valid)
            .catch(() => null);
        }

        const linkMatch = profiles.some((p) => existingLinks.has(p.public_url));
        if (linkMatch) {
          return {
            braintrustId: candidate.id,
            name: candidate.publicName,
            githubUrl: github?.public_url ?? null,
            linkedinUrl: linkedin?.public_url ?? null,
            linkedinVerified,
            externalProfiles: profiles,
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

        // A LinkedIn link that fails verification is still queued below —
        // linkedinVerified is stored purely as a signal, never a filter.
        return {
          braintrustId: candidate.id,
          name: candidate.publicName,
          githubUrl: github?.public_url ?? null,
          linkedinUrl: linkedin?.public_url ?? null,
          linkedinVerified,
          externalProfiles: profiles,
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
      `INSERT INTO todo (braintrust_id, name, github_url, linkedin_url, linkedin_verified, external_profiles, derived_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (braintrust_id) DO UPDATE
         SET status = 'pending',
             name = EXCLUDED.name,
             github_url = EXCLUDED.github_url,
             linkedin_url = EXCLUDED.linkedin_url,
             linkedin_verified = EXCLUDED.linkedin_verified,
             external_profiles = EXCLUDED.external_profiles,
             derived_email = EXCLUDED.derived_email
         WHERE todo.status = 'dismissed'`,
      [
        r.braintrustId,
        r.name,
        r.githubUrl,
        r.linkedinUrl,
        r.linkedinVerified,
        JSON.stringify(r.externalProfiles),
        r.derivedEmail,
      ]
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
