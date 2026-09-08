import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

// Moves a staged To Do entry into working_history + records, then removes
// it from the queue — all the heavy lifting (profile fetch, content build,
// dedup pre-check) already happened when it was added to the queue, so this
// is just a DB move.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const entryResult = await pool.query(
    `SELECT id, name, email, link, content, source FROM todo_entries WHERE id = $1`,
    [id]
  );
  const entry = entryResult.rows[0];
  if (!entry) {
    return NextResponse.json({ error: "To Do entry not found" }, { status: 404 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const whResult = await client.query<{ id: number }>(
      `INSERT INTO working_history (email, linkedin_url, content, source)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [entry.email, entry.link, entry.content, entry.source]
    );

    if (entry.source === "github") {
      await client.query(
        `UPDATE github_us SET applied = true, applied_at = now() WHERE linkedin_url = $1`,
        [entry.link]
      );
    } else if (entry.source === "hackerrank") {
      await client.query(
        `UPDATE hackerrank_matches SET added_to_todo = true WHERE linkedin_url = $1 OR github_url = $1`,
        [entry.link]
      );
    }

    const existingRecord = await client.query(
      `SELECT id FROM records WHERE ($1 <> '' AND lower(email) = lower($1)) OR link = $2 LIMIT 1`,
      [entry.email ?? "", entry.link]
    );
    if (existingRecord.rows.length === 0) {
      const resolvedName = entry.name || entry.email || entry.link;
      const sourceLabel =
        entry.source === "github"
          ? "Source: Github"
          : entry.source === "braintrust"
            ? "Source: Braintrust"
            : entry.source === "hackerrank"
              ? "Source: HackerRank"
              : "Source: Copy and Applied";
      await client.query(
        `INSERT INTO records (name, email, link, other) VALUES ($1, $2, $3, $4)`,
        [resolvedName, entry.email, entry.link, sourceLabel]
      );
    }

    await client.query(`DELETE FROM todo_entries WHERE id = $1`, [id]);

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, workingHistoryId: whResult.rows[0].id });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
