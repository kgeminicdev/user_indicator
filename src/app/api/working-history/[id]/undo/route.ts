import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

// Reverses a "Copy and Applied" logged in working_history: removes the
// records row it created, resets github_us.applied so the candidate
// reappears in the GitHub tab's default view, and deletes the working_history
// row itself. A Braintrust-sourced todo item is never touched here — a
// successful apply never removes it from `todo` in the first place, only an
// "already exists" apply does, so there's nothing to restore there.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const whResult = await client.query<{
      id: number;
      email: string | null;
      linkedin_url: string;
      source: string | null;
    }>(`SELECT id, email, linkedin_url, source FROM working_history WHERE id = $1 FOR UPDATE`, [
      id,
    ]);
    const wh = whResult.rows[0];
    if (!wh) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Working history entry not found" }, { status: 404 });
    }

    const deletedRecords = await client.query(
      `DELETE FROM records
       WHERE ($1 <> '' AND lower(email) = lower($1)) OR link = $2
       RETURNING id`,
      [wh.email ?? "", wh.linkedin_url]
    );

    if (wh.source === "github") {
      await client.query(
        `UPDATE github_us SET applied = false, applied_at = NULL WHERE linkedin_url = $1`,
        [wh.linkedin_url]
      );
    }

    await client.query(`DELETE FROM working_history WHERE id = $1`, [id]);

    await client.query("COMMIT");

    return NextResponse.json({ ok: true, recordsRemoved: deletedRecords.rows.length });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
