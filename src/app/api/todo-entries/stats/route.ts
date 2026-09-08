import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const result = await pool.query<{
    total: number;
    github: number;
    braintrust: number;
    hackerrank: number;
    content_ready: number;
    content_missing: number;
  }>(
    `SELECT
       count(*)::int AS total,
       count(*) FILTER (WHERE source = 'github')::int AS github,
       count(*) FILTER (WHERE source = 'braintrust')::int AS braintrust,
       count(*) FILTER (WHERE source = 'hackerrank')::int AS hackerrank,
       count(*) FILTER (WHERE content IS NOT NULL)::int AS content_ready,
       count(*) FILTER (WHERE content IS NULL)::int AS content_missing
     FROM todo_entries`
  );

  const row = result.rows[0];
  return NextResponse.json({
    total: row.total,
    github: row.github,
    braintrust: row.braintrust,
    hackerrank: row.hackerrank,
    contentReady: row.content_ready,
    contentMissing: row.content_missing,
  });
}
