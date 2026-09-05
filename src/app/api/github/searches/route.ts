import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const result = await pool.query(
    `SELECT id, location, years, status, total_count, already_in_db, already_in_braintrust,
            checked_new, with_email, already_in_records, current_window, current_page,
            jsonb_array_length(coalesce(windows, '[]'::jsonb)) AS total_windows,
            error_message, created_at, updated_at
     FROM github_us_searches
     ORDER BY updated_at DESC
     LIMIT 50`
  );
  return NextResponse.json(result.rows);
}
