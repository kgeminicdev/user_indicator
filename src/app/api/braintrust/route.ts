import { NextResponse } from "next/server";
import { braintrustPool } from "@/lib/braintrustDb";

const FILTER = `title = 'Engineering' AND jsonb_array_length(data->'external_profiles') > 0`;

export async function GET() {
  const [
    totalResult,
    filteredCountResult,
    platformCountsResult,
    syncResult,
    sampleResult,
  ] = await Promise.all([
    braintrustPool.query(`SELECT count(*)::int AS total FROM "Freelancer"`),
    braintrustPool.query(
      `SELECT count(*)::int AS total FROM "Freelancer" WHERE ${FILTER}`
    ),
    braintrustPool.query(`
      SELECT
        count(*) FILTER (WHERE has_linkedin)::int AS linkedin,
        count(*) FILTER (WHERE has_github)::int AS github,
        count(*) FILTER (WHERE has_personal)::int AS "personalWebsite"
      FROM (
        SELECT
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(data->'external_profiles') p
            WHERE p->'site'->>'name' = 'LinkedIn'
          ) AS has_linkedin,
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(data->'external_profiles') p
            WHERE p->'site'->>'name' = 'GitHub'
          ) AS has_github,
          EXISTS (
            SELECT 1 FROM jsonb_array_elements(data->'external_profiles') p
            WHERE p->'site'->>'name' = 'Personal Website'
          ) AS has_personal
        FROM "Freelancer"
        WHERE ${FILTER}
      ) sub
    `),
    braintrustPool.query(`SELECT * FROM "SyncStatus" ORDER BY id LIMIT 1`),
    braintrustPool.query(`
      SELECT
        id,
        "publicName",
        "syncedAt",
        (
          SELECT string_agg(s->'skill'->>'name', ', ' ORDER BY (s->>'order')::int)
          FROM jsonb_array_elements(data->'freelancer_skills') s
          WHERE (s->>'is_superpower')::boolean = true
        ) AS "basicStack",
        (
          SELECT r->>'years_experience'
          FROM jsonb_array_elements(data->'roles') r
          WHERE (r->>'primary')::boolean = true
          LIMIT 1
        ) AS "experienceYears",
        jsonb_array_length(coalesce(data->'freelancer_skills', '[]'::jsonb)) AS "skillCount",
        data->'external_profiles' AS "externalProfiles"
      FROM "Freelancer"
      WHERE ${FILTER}
      ORDER BY "syncedAt" DESC
      LIMIT 10
    `),
  ]);

  return NextResponse.json({
    total: totalResult.rows[0]?.total ?? 0,
    filteredTotal: filteredCountResult.rows[0]?.total ?? 0,
    platformCounts: platformCountsResult.rows[0] ?? {
      linkedin: 0,
      github: 0,
      personalWebsite: 0,
    },
    syncStatus: syncResult.rows[0] ?? null,
    sample: sampleResult.rows,
  });
}
