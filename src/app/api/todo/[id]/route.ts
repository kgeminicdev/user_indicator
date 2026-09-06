import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const action = body.action;
  const overrideEmail =
    typeof body.email === "string" ? body.email.trim() : undefined;

  if (action !== "approve" && action !== "delete") {
    return NextResponse.json(
      { error: "action must be 'approve' or 'delete'" },
      { status: 400 }
    );
  }

  const todoResult = await pool.query(
    `SELECT * FROM todo WHERE id = $1 AND status = 'pending'`,
    [id]
  );
  const todo = todoResult.rows[0];
  if (!todo) {
    return NextResponse.json(
      { error: "todo item not found or already handled" },
      { status: 404 }
    );
  }

  if (action === "approve") {
    const email = overrideEmail || todo.derived_email || null;
    if (email) {
      const duplicate = await pool.query(
        `SELECT id FROM records WHERE lower(email) = lower($1) LIMIT 1`,
        [email]
      );
      if (duplicate.rows.length > 0) {
        return NextResponse.json(
          { error: `${email} already exists in your records — not added.` },
          { status: 409 }
        );
      }
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (action === "approve") {
      const otherProfiles: { public_url: string }[] = todo.external_profiles ?? [];
      const link = todo.github_url || todo.linkedin_url || otherProfiles[0]?.public_url || null;
      const email = overrideEmail || todo.derived_email || null;
      const name = todo.name || email || link;
      await client.query(
        `INSERT INTO records (name, email, link, other) VALUES ($1, $2, $3, $4)`,
        [name, email, link, "Source: Braintrust"]
      );
      await client.query(`DELETE FROM todo WHERE id = $1`, [id]);
    } else {
      await client.query(`DELETE FROM todo WHERE id = $1`, [id]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return NextResponse.json({ ok: true, action });
}
