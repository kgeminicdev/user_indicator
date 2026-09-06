import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const status = body.status;

  if (!email) {
    return NextResponse.json({ error: "Provide an email" }, { status: 400 });
  }
  if (status !== "read" && status !== "interviewed") {
    return NextResponse.json(
      { error: "status must be 'read' or 'interviewed'" },
      { status: 400 }
    );
  }

  const column = status === "read" ? "read_at" : "interviewed_at";
  const result = await pool.query(
    `UPDATE working_history SET ${column} = now()
     WHERE lower(email) = lower($1)
     RETURNING id, email, ${column}`,
    [email]
  );

  if (result.rows.length === 0) {
    return NextResponse.json(
      { error: `No working history entry found for ${email} — Copy and Applied them first.` },
      { status: 404 }
    );
  }

  return NextResponse.json({ email, status, updated: result.rows.length });
}
