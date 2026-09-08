import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { fetchVeeProfile, VeeProfileError } from "@/lib/veeProfileData";
import { buildVeeApplyContent } from "@/lib/veeProfileFormat";

const CONCURRENCY = 3;

// Backfills content for To Do entries that were added without it (Add to
// To Do no longer blocks on a slow profile fetch). Pass { id } to fill in
// just one row (the "Get content" button); omit it to process every row
// still missing content (the periodic background refill script).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const id = body.id != null ? Number(body.id) : null;

  const whereClause = id ? "WHERE id = $1 AND content IS NULL" : "WHERE content IS NULL";
  const params = id ? [id] : [];

  const pending = await pool.query<{ id: number; link: string }>(
    `SELECT id, link FROM todo_entries ${whereClause} ORDER BY id ASC`,
    params
  );

  let updated = 0;
  const failures: string[] = [];

  for (let start = 0; start < pending.rows.length; start += CONCURRENCY) {
    const batch = pending.rows.slice(start, start + CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        try {
          const profile = await fetchVeeProfile(row.link);
          const content = buildVeeApplyContent(profile);
          await pool.query(`UPDATE todo_entries SET content = $1 WHERE id = $2`, [content, row.id]);
          updated++;
        } catch (err) {
          const message = err instanceof VeeProfileError ? err.message : (err as Error).message;
          failures.push(`#${row.id}: ${message}`);
        }
      })
    );
  }

  return NextResponse.json({
    processed: pending.rows.length,
    updated,
    failed: failures.length,
    failures,
  });
}
