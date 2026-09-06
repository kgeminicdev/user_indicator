import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const action = body.action;

  if (action !== "ignore" && action !== "unignore") {
    return NextResponse.json(
      { error: "action must be 'ignore' or 'unignore'" },
      { status: 400 }
    );
  }

  await pool.query(`UPDATE github_us SET ignored = $1 WHERE id = $2`, [
    action === "ignore",
    id,
  ]);

  return NextResponse.json({ ok: true });
}
