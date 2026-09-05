import { NextRequest, NextResponse } from "next/server";
import {
  fetchGithubProfile,
  findRealCommitterEmail,
  findLinkedinUrl,
  fetchMostRecentPushDate,
  isRealEmail,
  GithubRateLimitError,
} from "@/lib/githubEmail";
import { verifyLinkedinUrl } from "@/lib/linkedinVerify";
import { pool } from "@/lib/db";
import { braintrustPool } from "@/lib/braintrustDb";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CONCURRENCY = 5;
const PER_PAGE = 100;
const MAX_PAGES_PER_QUERY = 10; // GitHub search hard-caps each query at 1,000 results
const GITHUB_EPOCH = "2007-01-01"; // before any GitHub account could exist
// The search endpoint allows only 30 req/min (60000ms / 30 = 2000ms/req minimum).
// Use a bit more than that floor for safety margin against clock/network jitter.
const SEARCH_THROTTLE_MS = 2100;

type GithubSearchUser = {
  login: string;
  avatar_url: string;
  html_url: string;
  score: number;
};

type GithubSearchResponse = {
  total_count: number;
  incomplete_results: boolean;
  items: GithubSearchUser[];
};

type ResultItem = {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  score: number;
  email: string;
  location: string | null;
  alreadyInRecords: boolean;
  linkedinUrl: string | null;
  linkedinVerified: boolean | null;
  lastPushedAt: string | null;
};

type WindowMeta = { start: string; end: string; count: number };

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function midpointDate(startStr: string, endStr: string): string {
  const s = new Date(`${startStr}T00:00:00Z`).getTime();
  const e = new Date(`${endStr}T00:00:00Z`).getTime();
  return new Date(s + Math.floor((e - s) / 2)).toISOString().slice(0, 10);
}

async function fetchSearchByQuery(query: string, page: number): Promise<GithubSearchResponse> {
  const url = `https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${page}`;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (GITHUB_TOKEN) headers.Authorization = `token ${GITHUB_TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (
      (res.status === 403 || res.status === 429) &&
      res.headers.get("x-ratelimit-remaining") === "0"
    ) {
      const resetHeader = res.headers.get("x-ratelimit-reset");
      const resetAt = resetHeader
        ? new Date(Number(resetHeader) * 1000)
        : new Date(Date.now() + 60 * 60 * 1000);
      throw new GithubRateLimitError(resetAt);
    }
    const body = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${res.statusText} — ${body}`);
  }

  // Proactively back off if we're nearly out of search quota, rather than
  // waiting for the next call to fail — protects against clock drift and
  // against this quota being shared with other concurrent usage.
  const remaining = res.headers.get("x-ratelimit-remaining");
  const resetHeader = res.headers.get("x-ratelimit-reset");
  if (remaining !== null && Number(remaining) <= 2 && resetHeader) {
    const resetAt = new Date(Number(resetHeader) * 1000);
    await sleep(Math.max(0, resetAt.getTime() - Date.now()) + 1000);
  } else {
    await sleep(SEARCH_THROTTLE_MS);
  }
  return res.json();
}

export async function GET(request: NextRequest) {
  const resumeIdParam = request.nextUrl.searchParams.get("resumeId");
  const resumeId = resumeIdParam ? Number(resumeIdParam) : null;

  if (!resumeId) {
    const location = request.nextUrl.searchParams.get("location")?.trim();
    const years = Number(request.nextUrl.searchParams.get("years"));
    if (!location) {
      return NextResponse.json({ error: "Provide a location" }, { status: 400 });
    }
    if (!Number.isFinite(years) || years <= 0) {
      return NextResponse.json(
        { error: "Provide a positive number of years" },
        { status: 400 }
      );
    }
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      let searchId: number | null = null;

      try {
        let location: string;
        let years: number;
        let cutoffDate: string;
        let windows: WindowMeta[];
        let alreadyInDb: number;
        let alreadyInBraintrust: number;
        let checkedNew: number;
        let alreadyInRecordsCount: number;
        let incompleteWindows: number;
        let startWindow: number;
        let startPage: number;
        let requireLinkedin: boolean;
        let requireActiveLastYear: boolean;

        if (resumeId) {
          const existing = await pool.query(`SELECT * FROM github_us_searches WHERE id = $1`, [
            resumeId,
          ]);
          const row = existing.rows[0];
          if (!row) {
            send("error", { message: "Saved search not found" });
            controller.close();
            return;
          }
          searchId = row.id;
          location = row.location;
          years = row.years;
          cutoffDate = row.cutoff_date;
          windows = row.windows ?? [];
          alreadyInDb = row.already_in_db;
          alreadyInBraintrust = row.already_in_braintrust ?? 0;
          checkedNew = row.checked_new;
          alreadyInRecordsCount = row.already_in_records;
          incompleteWindows = row.incomplete_windows;
          startWindow = row.current_window;
          startPage = row.current_page + 1;
          requireLinkedin = row.require_linkedin;
          requireActiveLastYear = row.require_active_last_year;
          send("progress", {
            phase: "resuming",
            searchId,
            location,
            years,
            windowsFound: windows.length,
          });
        } else {
          location = request.nextUrl.searchParams.get("location")!.trim();
          years = Number(request.nextUrl.searchParams.get("years"));
          requireLinkedin = request.nextUrl.searchParams.get("requireLinkedin") === "true";
          requireActiveLastYear =
            request.nextUrl.searchParams.get("requireActiveLastYear") === "true";
          const cutoff = new Date();
          cutoff.setFullYear(cutoff.getFullYear() - years);
          cutoffDate = cutoff.toISOString().slice(0, 10);
          alreadyInDb = 0;
          alreadyInBraintrust = 0;
          checkedNew = 0;
          alreadyInRecordsCount = 0;
          incompleteWindows = 0;
          startWindow = 0;
          startPage = 1;

          const created = await pool.query<{ id: number }>(
            `INSERT INTO github_us_searches (location, years, cutoff_date, require_linkedin, require_active_last_year)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [location, years, cutoffDate, requireLinkedin, requireActiveLastYear]
          );
          searchId = created.rows[0].id;

          send("progress", { phase: "planning", searchId, windowsFound: 0, matchesFound: 0 });

          const collected: WindowMeta[] = [];
          async function collectWindows(start: string, end: string, depth: number) {
            const probe = await fetchSearchByQuery(
              `location:"${location}" created:${start}..${end} type:User`,
              1
            );
            if (probe.total_count === 0) return;

            const canSplit = start !== end && depth < 40;
            if (probe.total_count > MAX_PAGES_PER_QUERY * PER_PAGE && canSplit) {
              const mid = midpointDate(start, end);
              const nextStart = addDays(mid, 1);
              if (mid >= start && nextStart <= end) {
                await collectWindows(start, mid, depth + 1);
                await collectWindows(nextStart, end, depth + 1);
                return;
              }
            }

            if (probe.total_count > MAX_PAGES_PER_QUERY * PER_PAGE) incompleteWindows++;
            collected.push({ start, end, count: probe.total_count });
            send("progress", {
              phase: "planning",
              searchId,
              windowsFound: collected.length,
              matchesFound: collected.reduce((sum, w) => sum + w.count, 0),
            });
          }

          await collectWindows(GITHUB_EPOCH, cutoffDate, 0);
          windows = collected;

          await pool.query(
            `UPDATE github_us_searches SET windows = $1, incomplete_windows = $2, updated_at = now() WHERE id = $3`,
            [JSON.stringify(windows), incompleteWindows, searchId]
          );
        }

        // Refresh the true total for reporting (cheap: one call).
        const overall = await fetchSearchByQuery(
          `location:"${location}" created:<${cutoffDate} type:User`,
          1
        );
        const totalCount = overall.total_count;
        const incompleteResults = overall.incomplete_results;
        await pool.query(`UPDATE github_us_searches SET total_count = $1 WHERE id = $2`, [
          totalCount,
          searchId,
        ]);

        const recordsResult = await pool.query<{ email: string | null; link: string | null }>(
          `SELECT email, link FROM records`
        );
        const recordEmails = new Set(
          recordsResult.rows.map((r) => (r.email || "").toLowerCase()).filter(Boolean)
        );
        const recordLinks = new Set(recordsResult.rows.map((r) => r.link).filter(Boolean));

        const found: ResultItem[] = [];

        for (let w = startWindow; w < windows.length; w++) {
          const window = windows[w];
          const totalPagesInWindow = Math.min(
            MAX_PAGES_PER_QUERY,
            Math.ceil(window.count / PER_PAGE)
          );
          const firstPage = w === startWindow ? startPage : 1;

          for (let page = firstPage; page <= totalPagesInWindow; page++) {
            const data = await fetchSearchByQuery(
              `location:"${location}" created:${window.start}..${window.end} type:User`,
              page
            );
            if (data.items.length === 0) break;

            const existingResult = await pool.query<{ github_link: string }>(
              `SELECT github_link FROM github_us WHERE github_link = ANY($1)`,
              [data.items.map((u) => u.html_url)]
            );
            const existingLinks = new Set(existingResult.rows.map((r) => r.github_link));
            const notYetSaved = data.items.filter((u) => !existingLinks.has(u.html_url));
            alreadyInDb += data.items.length - notYetSaved.length;

            // Skip anyone already known as a Braintrust freelancer (matched
            // by their GitHub profile link) — no need to add them here too.
            const braintrustResult = await braintrustPool.query<{ github_link: string }>(
              `SELECT DISTINCT p->>'public_url' AS github_link
               FROM "Freelancer" f
               CROSS JOIN LATERAL jsonb_array_elements(f.data->'external_profiles') p
               WHERE p->'site'->>'name' = 'GitHub' AND p->>'public_url' = ANY($1)`,
              [notYetSaved.map((u) => u.html_url)]
            );
            const braintrustLinks = new Set(braintrustResult.rows.map((r) => r.github_link));
            const newItems = notYetSaved.filter((u) => !braintrustLinks.has(u.html_url));
            alreadyInBraintrust += notYetSaved.length - newItems.length;

            for (let start = 0; start < newItems.length; start += CONCURRENCY) {
              const batch = newItems.slice(start, start + CONCURRENCY);
              const batchResults = await Promise.all(
                batch.map(async (u): Promise<ResultItem | null> => {
                  const profile = await fetchGithubProfile(u.login).catch((err) => {
                    if (err instanceof GithubRateLimitError) throw err;
                    return null;
                  });
                  let email: string | null = null;
                  if (profile?.email && isRealEmail(profile.email)) {
                    email = profile.email;
                  } else {
                    email = await findRealCommitterEmail(u.login).catch((err) => {
                      if (err instanceof GithubRateLimitError) throw err;
                      return null;
                    });
                  }
                  if (!email) return null;

                  let linkedinUrl: string | null = null;
                  let linkedinVerified: boolean | null = null;
                  if (requireLinkedin) {
                    const candidateLinkedinUrl = await findLinkedinUrl(
                      u.login,
                      profile?.blog ?? null
                    ).catch((err) => {
                      if (err instanceof GithubRateLimitError) throw err;
                      return null;
                    });
                    if (!candidateLinkedinUrl) return null;

                    const verification = await verifyLinkedinUrl(candidateLinkedinUrl).catch(
                      () => ({ valid: false, name: null })
                    );
                    if (!verification.valid) return null;

                    linkedinUrl = candidateLinkedinUrl;
                    linkedinVerified = true;
                  }

                  let lastPushedAt: string | null = null;
                  if (requireActiveLastYear) {
                    lastPushedAt = await fetchMostRecentPushDate(u.login).catch((err) => {
                      if (err instanceof GithubRateLimitError) throw err;
                      return null;
                    });
                    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
                    if (!lastPushedAt || new Date(lastPushedAt).getTime() < oneYearAgo) {
                      return null;
                    }
                  }

                  const alreadyInRecords =
                    recordEmails.has(email.toLowerCase()) || recordLinks.has(u.html_url);
                  return {
                    login: u.login,
                    name: profile?.name ?? null,
                    avatarUrl: u.avatar_url,
                    htmlUrl: u.html_url,
                    score: u.score,
                    email,
                    location: profile?.location ?? null,
                    alreadyInRecords,
                    linkedinUrl,
                    linkedinVerified,
                    lastPushedAt,
                  };
                })
              );
              for (const r of batchResults) {
                checkedNew++;
                if (r) {
                  found.push(r);
                  if (r.alreadyInRecords) alreadyInRecordsCount++;
                  await pool.query(
                    `INSERT INTO github_us (name, github_link, email, avatar_url, location, already_in_records, linkedin_url, linkedin_verified)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (github_link) DO UPDATE
                       SET name = EXCLUDED.name,
                           email = EXCLUDED.email,
                           avatar_url = EXCLUDED.avatar_url,
                           location = EXCLUDED.location,
                           already_in_records = EXCLUDED.already_in_records,
                           linkedin_url = EXCLUDED.linkedin_url,
                           linkedin_verified = EXCLUDED.linkedin_verified`,
                    [
                      r.name,
                      r.htmlUrl,
                      r.email,
                      r.avatarUrl,
                      r.location,
                      r.alreadyInRecords,
                      r.linkedinUrl,
                      r.linkedinVerified,
                    ]
                  );
                }
              }
              send("progress", {
                phase: "checking",
                searchId,
                window: w + 1,
                totalWindows: windows.length,
                page,
                totalPagesInWindow,
                checkedNew,
                withEmail: found.length,
                alreadyInDb,
                alreadyInBraintrust,
              });
            }

            // Checkpoint after each fully-processed page — safe to redo if
            // interrupted mid-page, since already-saved users are skipped
            // via the github-table check next time.
            await pool.query(
              `UPDATE github_us_searches
               SET current_window = $1, current_page = $2, already_in_db = $3,
                   checked_new = $4, with_email = $5, already_in_records = $6,
                   already_in_braintrust = $7,
                   updated_at = now()
               WHERE id = $8`,
              [
                w,
                page,
                alreadyInDb,
                checkedNew,
                found.length,
                alreadyInRecordsCount,
                alreadyInBraintrust,
                searchId,
              ]
            );
          }
        }

        await pool.query(
          `UPDATE github_us_searches SET status = 'completed', error_message = NULL, updated_at = now() WHERE id = $1`,
          [searchId]
        );

        send("done", {
          searchId,
          totalCount,
          incompleteResults,
          incompleteWindows,
          cutoffDate,
          windowsScanned: windows.length,
          alreadyInDb,
          alreadyInBraintrust,
          checkedNew,
          withEmail: found.length,
          alreadyInRecords: alreadyInRecordsCount,
          items: found.filter((r) => !r.alreadyInRecords),
        });
      } catch (err) {
        if (searchId) {
          await pool
            .query(`UPDATE github_us_searches SET error_message = $1, updated_at = now() WHERE id = $2`, [
              (err as Error).message,
              searchId,
            ])
            .catch(() => {});
        }
        if (err instanceof GithubRateLimitError) {
          send("error", {
            searchId,
            message: `GitHub API rate limit exceeded — resets at ${err.resetAt.toLocaleString()}. Everything found so far is already saved; resume this search after that time to continue exactly where it left off.`,
            rateLimited: true,
            resetAt: err.resetAt.toISOString(),
          });
        } else {
          send("error", { searchId, message: (err as Error).message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
