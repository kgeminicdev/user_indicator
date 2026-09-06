import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (from) {
    params.push(from);
    conditions.push(`created_at >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    conditions.push(`created_at < ($${params.length}::date + interval '1 day')`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const [itemsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, email, linkedin_url, content, source, created_at
       FROM working_history
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, PAGE_SIZE, offset]
    ),
    pool.query(`SELECT count(*)::int AS total FROM working_history ${whereClause}`, params),
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

const VALID_SOURCES = new Set(["github", "braintrust"]);

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = typeof body.email === "string" ? body.email.trim() || null : null;
  const linkedinUrl = typeof body.linkedinUrl === "string" ? body.linkedinUrl.trim() : "";
  const content = typeof body.content === "string" ? body.content : null;
  const name = typeof body.name === "string" ? body.name.trim() || null : null;
  const source =
    typeof body.source === "string" && VALID_SOURCES.has(body.source) ? body.source : null;

  if (!linkedinUrl) {
    return NextResponse.json({ error: "Provide a linkedinUrl" }, { status: 400 });
  }

  const result = await pool.query(
    `INSERT INTO working_history (email, linkedin_url, content, source)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, linkedin_url, content, source, created_at`,
    [email, linkedinUrl, content, source]
  );

  // Mark the matching github_us row (if any) as applied, so the "Copy and
  // Applied" button stays done across reloads instead of resetting.
  await pool.query(
    `UPDATE github_us SET applied = true, applied_at = now() WHERE linkedin_url = $1`,
    [linkedinUrl]
  );

  // Also save to records, same dedup rule as /api/check-or-add (by email or
  // link) so re-applying an already-known candidate doesn't create a
  // duplicate row.
  const existingRecord = await pool.query(
    `SELECT id FROM records WHERE ($1 <> '' AND lower(email) = lower($1)) OR link = $2 LIMIT 1`,
    [email ?? "", linkedinUrl]
  );
  if (existingRecord.rows.length === 0) {
    const resolvedName = name || email || linkedinUrl;
    const sourceLabel =
      source === "github"
        ? "Source: Github"
        : source === "braintrust"
          ? "Source: Braintrust"
          : "Source: Copy and Applied";
    await pool.query(
      `INSERT INTO records (name, email, link, other) VALUES ($1, $2, $3, $4)`,
      [resolvedName, email, linkedinUrl, sourceLabel]
    );
  }

  return NextResponse.json(result.rows[0]);
}
