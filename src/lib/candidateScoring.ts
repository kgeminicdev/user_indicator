import { fetchJson } from "./githubEmail";

// ---------------------------------------------------------------------------
// US location detection — text-based, from the profile's self-reported
// location field only. No inference from name, photo, or any other signal.
// ---------------------------------------------------------------------------

const US_STATE_NAMES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
  "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
  "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine",
  "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi",
  "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
  "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina",
  "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia",
  "Washington", "West Virginia", "Wisconsin", "Wyoming",
];

const US_STATE_ABBRS = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID",
  "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS",
  "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK",
  "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY",
]);

/**
 * Heuristic only, based purely on the free-text location string the person
 * chose to put on their own profile — never inferred from name or photo.
 * Not perfect (e.g. "CA" collides with Canada), but a reasonable signal.
 */
export function looksLikeUSLocation(location: string | null | undefined): boolean {
  if (!location) return false;
  const text = location.trim();
  if (!text) return false;

  if (/\b(united states|usa|u\.s\.a\.?|u\.s\.)\b/i.test(text)) return true;
  for (const name of US_STATE_NAMES) {
    if (new RegExp(`\\b${name}\\b`, "i").test(text)) return true;
  }
  const abbrMatch = text.match(/,\s*([A-Za-z]{2})\b/);
  if (abbrMatch && US_STATE_ABBRS.has(abbrMatch[1].toUpperCase())) return true;
  return false;
}

// ---------------------------------------------------------------------------
// English-text heuristic — applied to the person's own bio text, not their
// name. Used as a proxy for written communication ability, not origin.
// ---------------------------------------------------------------------------

const COMMON_ENGLISH_WORDS = new Set([
  "the", "and", "is", "a", "an", "of", "to", "in", "for", "with", "on",
  "at", "by", "from", "i", "my", "im", "love", "building", "build",
  "working", "work", "based", "full", "stack", "developer", "engineer",
  "software", "web", "data", "open", "source", "passionate", "about",
  "years", "experience", "currently",
]);

/** Cheap, imperfect heuristic — good enough to distinguish "wrote in
 *  English" from "wrote in a non-Latin script" or "left it blank." */
export function looksLikeEnglish(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  const nonAsciiRatio =
    (trimmed.match(/[^\x00-\x7F]/g)?.length ?? 0) / trimmed.length;
  if (nonAsciiRatio > 0.15) return false;

  const words = trimmed.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length === 0) return false;
  if (words.length <= 3) return nonAsciiRatio < 0.05;

  return words.some((w) => COMMON_ENGLISH_WORDS.has(w)) || nonAsciiRatio < 0.05;
}

// ---------------------------------------------------------------------------
// GitHub data fetching
// ---------------------------------------------------------------------------

export type FullGithubProfile = {
  createdAt: string | null;
  publicRepos: number;
  followers: number;
  bio: string | null;
  company: string | null;
  location: string | null;
  login: string;
};

export async function fetchFullGithubProfile(username: string): Promise<FullGithubProfile> {
  const p = await fetchJson(`https://api.github.com/users/${username}`);
  return {
    createdAt: p.created_at ?? null,
    publicRepos: p.public_repos ?? 0,
    followers: p.followers ?? 0,
    bio: p.bio ?? null,
    company: p.company ?? null,
    location: p.location ?? null,
    login: p.login ?? username,
  };
}

type RepoSummary = {
  fork: boolean;
  language: string | null;
  stargazers_count: number;
  description: string | null;
  size: number;
  pushed_at: string;
};

export type RepoStats = {
  qualityRepoCount: number;
  totalStars: number;
  languages: string[];
  primaryLanguage: string | null;
  distinctActiveMonthsLastYear: number;
  mostRecentPushedAt: string | null;
};

export async function fetchRepoStats(username: string): Promise<RepoStats> {
  const repos: RepoSummary[] = await fetchJson(
    `https://api.github.com/users/${username}/repos?sort=pushed&direction=desc&per_page=100`
  );

  if (!Array.isArray(repos) || repos.length === 0) {
    return {
      qualityRepoCount: 0,
      totalStars: 0,
      languages: [],
      primaryLanguage: null,
      distinctActiveMonthsLastYear: 0,
      mostRecentPushedAt: null,
    };
  }

  const original = repos.filter((r) => !r.fork);
  const qualityRepoCount = original.filter(
    (r) => (r.description && r.description.trim().length > 0) || r.size > 0
  ).length;
  const totalStars = original.reduce((sum, r) => sum + (r.stargazers_count || 0), 0);

  const languageCounts = new Map<string, number>();
  for (const r of original) {
    if (!r.language) continue;
    languageCounts.set(r.language, (languageCounts.get(r.language) ?? 0) + 1);
  }
  const languages = [...languageCounts.keys()];
  const primaryLanguage =
    languages.sort((a, b) => (languageCounts.get(b)! - languageCounts.get(a)!))[0] ?? null;

  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const activeMonths = new Set<string>();
  for (const r of original) {
    const t = new Date(r.pushed_at).getTime();
    if (t >= oneYearAgo) activeMonths.add(r.pushed_at.slice(0, 7));
  }

  return {
    qualityRepoCount,
    totalStars,
    languages,
    primaryLanguage,
    distinctActiveMonthsLastYear: activeMonths.size,
    mostRecentPushedAt: repos[0]?.pushed_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type ScoreBreakdown = {
  usLocation: number;
  accountAge: number;
  recentActivity: number;
  techStackMatch: number;
  repoQuality: number;
  reputation: number;
  contributionConsistency: number;
  englishBio: number;
  professionalCompleteness: number;
};

export type ScoreResult = {
  total: number;
  breakdown: ScoreBreakdown;
  isLikelyAuthentic: boolean;
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

/**
 * 0-100 candidate score built entirely from observable, job-relevant GitHub
 * signals: self-reported US location text, account age, recent push
 * activity, matching tech stack, original-repo quality, star-based
 * reputation, contribution consistency, English-language bio, and profile
 * completeness. Does not use name, ethnicity, race, gender, or photo in any
 * way. If the account looks inauthentic (no repos, no followers, no bio —
 * or a GitHub App bot account), the total is zeroed regardless of the other
 * factors, since those numbers aren't meaningful for such an account.
 */
export function scoreCandidate(
  profile: FullGithubProfile,
  repoStats: RepoStats,
  requiredSkills: string[]
): ScoreResult {
  // US location: 15 pts, binary on the self-reported location text.
  const usLocation = looksLikeUSLocation(profile.location) ? 15 : 0;

  // Account age: 15 pts, scaling up to 8+ years.
  let accountAge = 0;
  if (profile.createdAt) {
    const ageYears = (Date.now() - new Date(profile.createdAt).getTime()) / (365 * 24 * 60 * 60 * 1000);
    accountAge = clamp((ageYears / 8) * 15, 0, 15);
  }

  // Recent activity: 15 pts, full credit within 30 days, 0 past a year.
  let recentActivity = 0;
  if (repoStats.mostRecentPushedAt) {
    const daysSince = (Date.now() - new Date(repoStats.mostRecentPushedAt).getTime()) / (24 * 60 * 60 * 1000);
    if (daysSince <= 30) recentActivity = 15;
    else if (daysSince < 365) recentActivity = 15 * (1 - (daysSince - 30) / (365 - 30));
  }

  // Tech stack match: 20 pts. If specific skills were requested, score by
  // how many of them appear among the person's repo languages. Otherwise,
  // fall back to a language-diversity signal.
  let techStackMatch: number;
  if (requiredSkills.length > 0) {
    const have = new Set(repoStats.languages.map((l) => l.toLowerCase()));
    const matched = requiredSkills.filter((s) => have.has(s.toLowerCase())).length;
    techStackMatch = clamp((matched / requiredSkills.length) * 20, 0, 20);
  } else {
    techStackMatch = clamp((repoStats.languages.length / 5) * 20, 0, 20);
  }

  // Repo quality: 10 pts, scaling up to 10 original, non-empty repos.
  const repoQuality = clamp((repoStats.qualityRepoCount / 10) * 10, 0, 10);

  // Reputation: 10 pts, log-scaled since stars are extremely skewed.
  const reputation = clamp(Math.log10(repoStats.totalStars + 1) * 4, 0, 10);

  // Contribution consistency: 5 pts, scaling with distinct active months
  // (out of the last 12) rather than raw commit count.
  const contributionConsistency = clamp(
    (repoStats.distinctActiveMonthsLastYear / 12) * 5,
    0,
    5
  );

  // English bio: 5 pts if their own bio text reads as English.
  const englishBio = looksLikeEnglish(profile.bio) ? 5 : 0;

  // Profile completeness: up to 5 pts for having a company and/or bio set.
  const professionalCompleteness =
    (profile.company ? 3 : 0) + (profile.bio ? 2 : 0);

  const breakdown: ScoreBreakdown = {
    usLocation,
    accountAge: Math.round(accountAge),
    recentActivity: Math.round(recentActivity),
    techStackMatch: Math.round(techStackMatch),
    repoQuality: Math.round(repoQuality),
    reputation: Math.round(reputation),
    contributionConsistency: Math.round(contributionConsistency),
    englishBio,
    professionalCompleteness,
  };

  const rawTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);

  const isBotAccount = profile.login.toLowerCase().endsWith("[bot]");
  const hasAnySignal = profile.publicRepos > 0 || profile.followers > 0 || Boolean(profile.bio);
  const isLikelyAuthentic = !isBotAccount && hasAnySignal;

  return {
    total: isLikelyAuthentic ? clamp(rawTotal, 0, 100) : 0,
    breakdown,
    isLikelyAuthentic,
  };
}
