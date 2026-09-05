// Calls the locally-running LinkedIn profile verification tool. It fetches
// the profile at the given URL and returns its display name if the profile
// exists; an empty name means the URL isn't a real, reachable profile.
const LINKEDIN_VERIFY_URL = process.env.LINKEDIN_VERIFY_URL || "https://linkedprofileviewer.com/api/profile";

export class LinkedinVerifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkedinVerifyError";
  }
}

export type LinkedinVerifyResult = {
  valid: boolean;
  name: string | null;
};

export async function verifyLinkedinUrl(url: string): Promise<LinkedinVerifyResult> {
  let response: Response;
  try {
    response = await fetch(LINKEDIN_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
  } catch (err) {
    throw new LinkedinVerifyError(
      `Failed to reach LinkedIn verify tool at ${LINKEDIN_VERIFY_URL}: ${(err as Error).message}`
    );
  }

  if (!response.ok) {
    throw new LinkedinVerifyError(
      `LinkedIn verify tool error: ${response.status} ${response.statusText}`
    );
  }

  const body: { name?: string } = await response.json();
  const name = body.name ?? null;
  return { valid: Boolean(name && name != "LinkedIn User"), name };
}
