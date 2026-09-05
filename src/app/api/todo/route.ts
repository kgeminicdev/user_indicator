import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

const PAGE_SIZE = 10;

export async function GET(request: NextRequest) {
  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1;
  const offset = (page - 1) * PAGE_SIZE;
  const showHidden = request.nextUrl.searchParams.get("view") === "hidden";

  const [itemsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT * FROM todo WHERE status = 'pending' AND hidden = $3 ORDER BY id DESC LIMIT $1 OFFSET $2`,
      [PAGE_SIZE, offset, showHidden]
    ),
    pool.query(
      `SELECT count(*)::int AS total FROM todo WHERE status = 'pending' AND hidden = $1`,
      [showHidden]
    ),
  ]);

  const total = countResult.rows[0]?.total ?? 0;

  return NextResponse.json({
    items: itemsResult.rows,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
