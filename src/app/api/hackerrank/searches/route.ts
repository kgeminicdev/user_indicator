import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function GET() {
  const result = await pool.query(
    `SELECT id, skill, start_page, end_page, current_page, status,
            scanned, matched, already_in_db, already_in_records,
            error_message, created_at, updated_at
     FROM hackerrank_scans
     ORDER BY updated_at DESC
     LIMIT 50`
  );
  return NextResponse.json(result.rows);
}
