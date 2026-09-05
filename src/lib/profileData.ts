// Server-side only. Looks up a LinkedIn profile via a locally-running
// lookup service that returns Enrichlayer-format profile JSON — never
// forward the response anywhere but this app's own UI.
const PROFILE_API_URL = process.env.PROFILE_API_URL || "http://localhost:4000/";
// Sent verbatim as the Authorization header value (no "Bearer " prefix) —
// put the raw token in the env var.
const PROFILE_API_TOKEN = process.env.PROFILE_API_TOKEN;

export type ProfileWorkExperience = {
  startDate: string | null;
  endDate: string | null;
  companyName: string;
  title: string;
  description: string | null;
  location: string | null;
  companyInfo?: {
    linkedin?: { logoUrl?: string | null; website?: string | null } | null;
  } | null;
};

export type ProfileEducation = {
  startDate: string | null;
  endDate: string | null;
  fieldOfStudy: string | null;
  degreeName: string | null;
  school: string;
  logoUrl: string | null;
};

export type ProfileCertification = {
  startDate: string | null;
  endDate: string | null;
  name: string;
  authority: string | null;
  url: string | null;
};

export type ProfileLanguage = {
  name: string;
  proficiency: string;
};

export type ProfileActivity = {
  title: string;
  url: string;
};

export type ProfileData = {
  summary: {
    fullName: string;
    profileImage: string | null;
    jobTitle: string | null;
    currentCompanies: string[];
    location: string | null;
  };
  slug: { linkedin: string | null; github: string | null };
  headline: string | null;
  about: string | null;
  location: { rawLocationString: string | null } | null;
  experience: { work: ProfileWorkExperience[] };
  education: ProfileEducation[];
  certifications: ProfileCertification[];
  languages: ProfileLanguage[];
  socialPresence: {
    followers: { total: number | null };
    connections: { total: number | null };
  };
  activities: ProfileActivity[];
};

export class ProfileDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileDataError";
  }
}

export async function fetchProfileByUrl(profileUrl: string): Promise<ProfileData> {
  const url = new URL(PROFILE_API_URL);
  url.searchParams.set("profile", profileUrl);

  const headers: Record<string, string> = {};
  if (PROFILE_API_TOKEN) headers.Authorization = PROFILE_API_TOKEN;

  let response: Response;
  try {
    response = await fetch(url.toString(), { headers });
  } catch (err) {
    throw new ProfileDataError(
      `Failed to reach profile lookup service at ${PROFILE_API_URL}: ${(err as Error).message}`
    );
  }

  if (!response.ok) {
    throw new ProfileDataError(
      `Profile lookup service error: ${response.status} ${response.statusText}`
    );
  }

  try {
    return await response.json();
  } catch (err) {
    throw new ProfileDataError(
      `Profile lookup service returned invalid JSON: ${(err as Error).message}`
    );
  }
}
