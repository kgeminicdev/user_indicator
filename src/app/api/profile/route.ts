import { NextRequest, NextResponse } from "next/server";
import { fetchProfileByUrl, ProfileDataError } from "@/lib/profileData";

export async function GET(request: NextRequest) {
  const profileUrl = request.nextUrl.searchParams.get("url")?.trim();
  if (!profileUrl) {
    return NextResponse.json({ error: "Provide a profile url" }, { status: 400 });
  }

  try {
    const data = await fetchProfileByUrl(profileUrl);
    return NextResponse.json(data);
  } catch (err) {
    if (err instanceof ProfileDataError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
