import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const PAGE_SIZE = 20;

export async function GET(request: NextRequest) {
  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;

  const [itemsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, name, email, link, content, source, created_at
       FROM todo_entries
       ORDER BY id DESC
       LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, offset]
    ),
    pool.query(`SELECT count(*)::int AS total FROM todo_entries`),
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

const VALID_SOURCES = new Set(["github", "braintrust", "hackerrank"]);

export async function POST(request: NextRequest) {
  const body = await request.json();
  const name = typeof body.name === "string" ? body.name.trim() || null : null;
  const email = typeof body.email === "string" ? body.email.trim() || null : null;
  const link = typeof body.link === "string" ? body.link.trim() : "";
  const content = typeof body.content === "string" ? body.content : null;
  const source =
    typeof body.source === "string" && VALID_SOURCES.has(body.source) ? body.source : null;

  // Name/email/link are required up front; content is fetched from the
  // link lazily (background refill job or the manual "Get content" button)
  // rather than blocking Add to To Do on a slow profile lookup.
  if (!name) {
    return NextResponse.json({ error: "Provide a name" }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json({ error: "Provide an email" }, { status: 400 });
  }
  if (!link) {
    return NextResponse.json({ error: "Provide a link" }, { status: 400 });
  }

  // Skip anyone already finalized into records, or already staged here —
  // no point queuing the same candidate twice.
  const existing = await pool.query(
    `SELECT id FROM records WHERE ($1 <> '' AND lower(email) = lower($1)) OR link = $2
     UNION ALL
     SELECT id FROM todo_entries WHERE ($1 <> '' AND lower(email) = lower($1)) OR link = $2
     LIMIT 1`,
    [email ?? "", link]
  );
  if (existing.rows.length > 0) {
    return NextResponse.json({ exists: true });
  }

  const result = await pool.query(
    `INSERT INTO todo_entries (name, email, link, content, source)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, email, link, content, source, created_at`,
    [name, email, link, content, source]
  );

  // Reflect "already staged" immediately on the source list, so the same
  // candidate can't be queued twice from there while this is still pending
  // in the To Do queue.
  if (source === "github") {
    await pool.query(
      `UPDATE github_us SET applied = true, applied_at = now() WHERE linkedin_url = $1`,
      [link]
    );
  } else if (source === "hackerrank") {
    await pool.query(
      `UPDATE hackerrank_matches SET added_to_todo = true WHERE linkedin_url = $1 OR github_url = $1`,
      [link]
    );
  }

  return NextResponse.json({ exists: false, item: result.rows[0] });
}
