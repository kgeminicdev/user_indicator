import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;
  const showAlreadyInRecords = request.nextUrl.searchParams.get("showAlreadyInRecords") === "true";
  const showIgnored = request.nextUrl.searchParams.get("showIgnored") === "true";
  const showAdded = request.nextUrl.searchParams.get("showAdded") === "true";
  const skill = request.nextUrl.searchParams.get("skill");

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (!showAlreadyInRecords) conditions.push("already_in_records = false");
  if (!showIgnored) conditions.push("ignored = false");
  if (!showAdded) conditions.push("added_to_todo = false");
  if (skill) {
    params.push(skill);
    conditions.push(`skill = $${params.length}`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [itemsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, hacker, hacker_id, name, website, linkedin_url, github_url, resume_url,
              rank, score, skill, already_in_records, added_to_todo, ignored, avatar_url, created_at
       FROM hackerrank_matches
       ${whereClause}
       ORDER BY
         (
           (website IS NOT NULL)::int +
           (linkedin_url IS NOT NULL)::int +
           (github_url IS NOT NULL)::int +
           (resume_url IS NOT NULL)::int
         ) DESC,
         (resume_url IS NOT NULL) DESC,
         id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, PAGE_SIZE, offset]
    ),
    pool.query(`SELECT count(*)::int AS total FROM hackerrank_matches ${whereClause}`, params),
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
