import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await pool.query(`DELETE FROM hackerrank_scans WHERE id = $1`, [id]);
  return NextResponse.json({ ok: true });
}
