import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { pool } from "@/lib/db";

type Row = Record<string, unknown>;

function normalizeKey(key: string): string {
  return key.trim().toLowerCase();
}

function pick(row: Row, keys: string[]): string | null {
  const normalized: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    normalized[normalizeKey(k)] = v;
  }
  for (const key of keys) {
    const value = normalized[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return NextResponse.json({ error: "Workbook has no sheets" }, { status: 400 });
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "" });

  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows found in sheet" }, { status: 400 });
  }

  const records = rows
    .map((row) => {
      const email = pick(row, ["email"]);
      const name = pick(row, ["name"]) ?? email;
      return {
        name,
        email,
        link: pick(row, ["link", "url"]),
        other: pick(row, ["other", "notes", "note"]),
      };
    })
    .filter((r) => r.name !== null) as {
    name: string;
    email: string | null;
    link: string | null;
    other: string | null;
  }[];

  if (records.length === 0) {
    return NextResponse.json(
      { error: "No valid rows found (each row needs a 'name' or 'email' value)" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  let inserted = 0;
  try {
    await client.query("BEGIN");
    for (const r of records) {
      await client.query(
        `INSERT INTO records (name, email, link, other) VALUES ($1, $2, $3, $4)`,
        [r.name, r.email, r.link, r.other]
      );
      inserted++;
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return NextResponse.json({ inserted, totalRows: rows.length });
}
