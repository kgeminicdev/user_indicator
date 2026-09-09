import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { pool } from "@/lib/db";

export async function GET() {
  const result = await pool.query<{ email: string | null; content: string | null }>(
    `SELECT email, content FROM todo_entries ORDER BY id DESC`
  );

  const rows = result.rows.map((r) => ({ Email: r.email ?? "", Content: r.content ?? "" }));

  const sheet = XLSX.utils.json_to_sheet(rows, { header: ["Email", "Content"] });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "To Do");
  // XLSX.write's Uint8Array is typed against ArrayBufferLike, which recent
  // @types/node's stricter BlobPart/BodyInit (ArrayBuffer-only) rejects even
  // though it's a perfectly valid buffer at runtime.
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as Uint8Array;
  const blob = new Blob([bytes as unknown as BlobPart]);

  const filename = `todo-${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(blob, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
