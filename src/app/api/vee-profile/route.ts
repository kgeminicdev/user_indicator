import { NextRequest, NextResponse } from "next/server";
import { fetchVeeProfile, VeeProfileError } from "@/lib/veeProfileData";

export async function GET(request: NextRequest) {
  const profileUrl = request.nextUrl.searchParams.get("url")?.trim();
  if (!profileUrl) {
    return NextResponse.json({ error: "Provide a profile url" }, { status: 400 });
  }

  try {
    const data = await fetchVeeProfile(profileUrl);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof VeeProfileError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
