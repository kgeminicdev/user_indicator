import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

// Same move as /[id]/apply, just looped over every queued entry — meant for
// "I already downloaded the Excel with everyone's email/content, now mark
// them all applied" instead of clicking Copy and Applied one row at a time.
// Each entry gets its own transaction so one bad row doesn't block the rest.
export async function POST() {
  const entriesResult = await pool.query<{
    id: number;
    name: string | null;
    email: string | null;
    link: string;
    content: string | null;
    source: string | null;
  }>(`SELECT id, name, email, link, content, source FROM todo_entries ORDER BY id`);
  const entries = entriesResult.rows;

  const client = await pool.connect();
  let applied = 0;
  const failures: string[] = [];
  try {
    for (const entry of entries) {
      try {
        await client.query("BEGIN");

        await client.query(
          `INSERT INTO working_history (email, linkedin_url, content, source)
           VALUES ($1, $2, $3, $4)`,
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

        await client.query(`DELETE FROM todo_entries WHERE id = $1`, [entry.id]);

        await client.query("COMMIT");
        applied++;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        failures.push(`${entry.name || entry.email || entry.link}: ${(err as Error).message}`);
      }
    }
  } finally {
    client.release();
  }

  return NextResponse.json({ applied, failed: failures.length, total: entries.length, failures });
}
