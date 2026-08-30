import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const link = typeof body.link === "string" ? body.link.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const other = typeof body.other === "string" ? body.other.trim() : "";
  const onlySearch = body.onlySearch === true;

  if (!email && !link) {
    return NextResponse.json(
      { error: "Provide at least an email or a link" },
      { status: 400 }
    );
  }

  const existing = await pool.query(
    `SELECT * FROM records WHERE ($1 <> '' AND lower(email) = lower($1)) OR ($2 <> '' AND link = $2) LIMIT 1`,
    [email, link]
  );

  if (existing.rows.length > 0) {
    return NextResponse.json({ exists: true, record: existing.rows[0] });
  }

  if (onlySearch) {
    return NextResponse.json({ exists: false, record: null });
  }

  const resolvedName = name || email || link;
  const inserted = await pool.query(
    `INSERT INTO records (name, email, link, other) VALUES ($1, $2, $3, $4) RETURNING *`,
    [resolvedName, email || null, link || null, other || null]
  );

  return NextResponse.json({ exists: false, record: inserted.rows[0] });
}
