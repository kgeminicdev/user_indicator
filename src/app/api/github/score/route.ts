import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { extractGithubUsername, GithubRateLimitError } from "@/lib/githubEmail";
import { fetchFullGithubProfile, fetchRepoStats, scoreCandidate } from "@/lib/candidateScoring";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map(Number) : [];
  const requiredSkills: string[] = Array.isArray(body.requiredSkills)
    ? body.requiredSkills.map(String).filter(Boolean)
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "Provide at least one id" }, { status: 400 });
  }

  const { rows } = await pool.query<{ id: number; github_link: string }>(
    `SELECT id, github_link FROM github_us WHERE id = ANY($1)`,
    [ids]
  );

  const results: { id: number; total: number | null; error: string | null }[] = [];

  for (const row of rows) {
    const username = extractGithubUsername(row.github_link);
    if (!username) {
      results.push({ id: row.id, total: null, error: "Could not parse GitHub username" });
      continue;
    }
    try {
      const [profile, repoStats] = await Promise.all([
        fetchFullGithubProfile(username),
        fetchRepoStats(username),
      ]);
      const { total, breakdown, isLikelyAuthentic } = scoreCandidate(
        profile,
        repoStats,
        requiredSkills
      );

      await pool.query(
        `UPDATE github_us SET
           score_total = $1,
           score_breakdown = $2,
           scored_at = now(),
           account_created_at = $3,
           last_pushed_at = $4,
           public_repos = $5,
           followers = $6,
           total_stars = $7,
           bio = $8,
           company = $9,
           primary_language = $10,
           is_likely_authentic = $11
         WHERE id = $12`,
        [
          total,
          JSON.stringify(breakdown),
          profile.createdAt,
          repoStats.mostRecentPushedAt,
          profile.publicRepos,
          profile.followers,
          repoStats.totalStars,
          profile.bio,
          profile.company,
          repoStats.primaryLanguage,
          isLikelyAuthentic,
          row.id,
        ]
      );

      results.push({ id: row.id, total, error: null });
    } catch (err) {
      const message = (err as Error).message;
      results.push({ id: row.id, total: null, error: message });
      if (err instanceof GithubRateLimitError) break;
    }
  }

  return NextResponse.json({ results });
}
