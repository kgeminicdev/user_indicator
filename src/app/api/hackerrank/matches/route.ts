import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;
  const showAlreadyInRecords = request.nextUrl.searchParams.get("showAlreadyInRecords") === "true";
  const showIgnored = request.nextUrl.searchParams.get("showIgnored") === "true";

  const conditions: string[] = [];
  if (!showAlreadyInRecords) conditions.push("already_in_records = false");
  if (!showIgnored) conditions.push("ignored = false");
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [itemsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, hacker, hacker_id, name, website, linkedin_url, github_url, resume_url,
              rank, score, skill, already_in_records, added_to_todo, ignored, created_at
       FROM hackerrank_matches
       ${whereClause}
       ORDER BY id DESC
       LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, offset]
    ),
    pool.query(`SELECT count(*)::int AS total FROM hackerrank_matches ${whereClause}`),
  ]);

  const total = countResult.rows[0]?.total ?? 0;

  return NextResponse.json({
    items: itemsResult.rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
