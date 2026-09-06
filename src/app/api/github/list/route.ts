import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;
  const showIgnored = request.nextUrl.searchParams.get("showIgnored") === "true";
  const hideApplied = request.nextUrl.searchParams.get("hideApplied") === "true";

  const conditions: string[] = [];
  if (!showIgnored) conditions.push("ignored = false");
  if (hideApplied) conditions.push("applied = false");
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [itemsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, name, github_link, email, avatar_url, location, already_in_records,
              linkedin_url, linkedin_verified, applied, applied_at, ignored,
              account_created_at, last_pushed_at,
              public_repos, followers, total_stars, bio, company, primary_language,
              is_likely_authentic, created_at
       FROM github_us
       ${whereClause}
       ORDER BY id DESC
       LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, offset]
    ),
    pool.query(`SELECT count(*)::int AS total FROM github_us ${whereClause}`),
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
