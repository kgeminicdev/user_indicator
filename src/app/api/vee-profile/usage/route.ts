import { NextResponse } from "next/server";
import { fetchVeeUsage, VeeProfileError } from "@/lib/veeProfileData";

export async function GET() {
  try {
    const usage = await fetchVeeUsage();
    return NextResponse.json(usage);
  } catch (err) {
    if (err instanceof VeeProfileError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
