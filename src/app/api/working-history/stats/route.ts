import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

// Counts rows where `statusColumn` is set, scoped to the same date range
// (by created_at, i.e. when they were applied to) that "applied in range"
// and the table itself use — not by when they were read/interviewed, so all
// three stats answer the same question: "of who was applied to in this
// range, how many are read/interviewed."
function dateFilter(statusColumn: string, from: string | null, to: string | null) {
  const conditions: string[] = [`${statusColumn} IS NOT NULL`];
  const params: unknown[] = [];
  if (from) {
    params.push(from);
    conditions.push(`created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`created_at < ($${params.length}::date + interval '1 day')`);
  }
  return { where: conditions.join(" AND "), params };
}

export async function GET(request: NextRequest) {
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  const readQuery = dateFilter("read_at", from, to);
  const interviewedQuery = dateFilter("interviewed_at", from, to);

  const [readResult, interviewedResult] = await Promise.all([
    pool.query(`SELECT count(*)::int AS total FROM working_history WHERE ${readQuery.where}`, readQuery.params),
    pool.query(
      `SELECT count(*)::int AS total FROM working_history WHERE ${interviewedQuery.where}`,
      interviewedQuery.params
    ),
  ]);

  return NextResponse.json({
    read: readResult.rows[0]?.total ?? 0,
    interviewed: interviewedResult.rows[0]?.total ?? 0,
  });
}
