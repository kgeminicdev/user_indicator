import { NextRequest, NextResponse } from "next/server";
import { verifyLinkedinUrl, LinkedinVerifyError } from "@/lib/linkedinVerify";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const url = typeof body.url === "string" ? body.url.trim() : "";

  if (!url) {
    return NextResponse.json({ error: "Provide a LinkedIn url" }, { status: 400 });
  }

  try {
    const result = await verifyLinkedinUrl(url);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof LinkedinVerifyError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}
