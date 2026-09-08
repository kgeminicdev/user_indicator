import { NextRequest, NextResponse } from "next/server";
import { hackerrankFetch, HackerRankError } from "@/lib/hackerrank";
import { verifyLinkedinUrl } from "@/lib/linkedinVerify";
import { pool } from "@/lib/db";

const CONCURRENCY = 5;
const PAGE_SIZE = 100;

type LeaderboardModel = {
  hacker_id: number;
  hacker: string;
  score: number;
  rank: number;
};

type LeaderboardResponse = {
  models: LeaderboardModel[];
  total?: number;
};

type ProfileModel = {
  username?: string;
  name?: string;
  website?: string | null;
  linkedin_url?: string | null;
  github_url?: string | null;
  show_profile_resume?: boolean | null;
  resume?: { resume_url?: string | null } | null;
};

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLeaderboardPage(skill: string, page: number): Promise<LeaderboardResponse> {
  // The API paginates by offset, not page number — page 1 is offset 0,
  // page 2 is offset 100, page 3 is offset 200, and so on.
  const offset = (page - 1) * PAGE_SIZE;
  return (await hackerrankFetch(
    `/rest/contests/master/tracks/${encodeURIComponent(skill)}/leaderboard/filter`,
    {
      type: "practice",
      limit: String(PAGE_SIZE),
      level: "5",
      elo_version: "true",
      country: "United States",
      offset: String(offset),
    }
  )) as LeaderboardResponse;
}

export async function GET(request: NextRequest) {
  const resumeIdParam = request.nextUrl.searchParams.get("resumeId");
  const resumeId = resumeIdParam ? Number(resumeIdParam) : null;

  if (!resumeId) {
    const skill = request.nextUrl.searchParams.get("skill")?.trim();
    if (!skill) {
      return NextResponse.json({ error: "Provide a skill (track)" }, { status: 400 });
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

      let scanId: number | null = null;

      try {
        let skill: string;
        let endPage: number;
        let currentPage: number;
        let scanned: number;
        let matchedTotal: number;
        let alreadyInDb: number;
        let alreadyInRecordsCount: number;
        let probeResult: LeaderboardResponse | null = null;

        if (resumeId) {
          const existing = await pool.query(`SELECT * FROM hackerrank_scans WHERE id = $1`, [
            resumeId,
          ]);
          const row = existing.rows[0];
          if (!row) {
            send("error", { message: "Saved scan not found" });
            controller.close();
            return;
          }
          scanId = row.id;
          skill = row.skill;
          endPage = row.end_page;
          currentPage = row.current_page;
          scanned = row.scanned;
          matchedTotal = row.matched;
          alreadyInDb = row.already_in_db;
          alreadyInRecordsCount = row.already_in_records;
          send("progress", { phase: "resuming", scanId, skill, endPage, currentPage });
        } else {
          skill = request.nextUrl.searchParams.get("skill")!.trim();
          currentPage = 0;
          scanned = 0;
          matchedTotal = 0;
          alreadyInDb = 0;
          alreadyInRecordsCount = 0;

          // Page 1 tells us how many total users (and therefore pages) this
          // skill's leaderboard has — the scan covers all of them, not a
          // manually-picked range.
          probeResult = await fetchLeaderboardPage(skill, 1);
          const total =
            typeof probeResult.total === "number"
              ? probeResult.total
              : probeResult.models?.length ?? 0;
          endPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

          const created = await pool.query<{ id: number }>(
            `INSERT INTO hackerrank_scans (skill, start_page, end_page) VALUES ($1, 1, $2) RETURNING id`,
            [skill, endPage]
          );
          scanId = created.rows[0].id;

          send("progress", { phase: "planning", scanId, skill, totalUsers: total, totalPages: endPage });
        }

        // Refreshed once per resume segment — cheap enough, and records
        // rarely change mid-scan.
        const recordsResult = await pool.query<{ link: string | null }>(
          `SELECT link FROM records WHERE link IS NOT NULL`
        );
        const existingLinks = new Set(recordsResult.rows.map((r) => r.link));

        const newItems: {
          hacker: string;
          name: string | null;
          website: string | null;
          linkedinUrl: string | null;
          githubUrl: string | null;
          resumeUrl: string | null;
        }[] = [];
        const failures: string[] = [];

        for (let page = currentPage + 1; page <= endPage; page++) {
          const leaderboard =
            page === 1 && probeResult ? probeResult : await fetchLeaderboardPage(skill, page);

          const hackers = leaderboard.models ?? [];
          if (hackers.length === 0) break;

          const existingResult = await pool.query<{ hacker: string }>(
            `SELECT hacker FROM hackerrank_matches WHERE hacker = ANY($1)`,
            [hackers.map((h) => h.hacker)]
          );
          const knownHackers = new Set(existingResult.rows.map((r) => r.hacker));
          const notYetSaved = hackers.filter((h) => !knownHackers.has(h.hacker));
          alreadyInDb += hackers.length - notYetSaved.length;

          for (let start = 0; start < notYetSaved.length; start += CONCURRENCY) {
            const batch = notYetSaved.slice(start, start + CONCURRENCY);
            await Promise.all(
              batch.map(async (h) => {
                scanned++;
                try {
                  const profileRes = (await hackerrankFetch(
                    `/rest/contests/master/hackers/${encodeURIComponent(h.hacker)}/profile`,
                    undefined,
                    { useCookie: false }
                  )) as { model: ProfileModel };
                  const profile = profileRes.model;
                  if (!profile) return;

                  const website =
                    profile.website?.trim() && isValidUrl(profile.website.trim())
                      ? profile.website.trim()
                      : null;
                  const githubUrl =
                    profile.github_url?.trim() && isValidUrl(profile.github_url.trim())
                      ? profile.github_url.trim()
                      : null;

                  let linkedinUrl: string | null = null;
                  const rawLinkedin = profile.linkedin_url?.trim();
                  if (rawLinkedin) {
                    const verification = await verifyLinkedinUrl(rawLinkedin).catch(() => ({
                      valid: false,
                      name: null,
                    }));
                    if (verification.valid) linkedinUrl = rawLinkedin;
                  }

                  const resumeUrl =
                    profile.show_profile_resume && profile.resume?.resume_url
                      ? profile.resume.resume_url
                      : null;

                  if (!website && !githubUrl && !linkedinUrl && !resumeUrl) return;

                  const alreadyKnown = Boolean(
                    (linkedinUrl && existingLinks.has(linkedinUrl)) ||
                      (githubUrl && existingLinks.has(githubUrl))
                  );
                  if (alreadyKnown) alreadyInRecordsCount++;
                  else matchedTotal++;

                  await pool.query(
                    `INSERT INTO hackerrank_matches
                       (hacker, hacker_id, name, website, linkedin_url, github_url, resume_url, rank, score, skill, already_in_records)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                     ON CONFLICT (hacker) DO UPDATE
                       SET name = EXCLUDED.name,
                           website = EXCLUDED.website,
                           linkedin_url = EXCLUDED.linkedin_url,
                           github_url = EXCLUDED.github_url,
                           resume_url = EXCLUDED.resume_url,
                           already_in_records = EXCLUDED.already_in_records`,
                    [
                      h.hacker,
                      h.hacker_id,
                      profile.name ?? null,
                      website,
                      linkedinUrl,
                      githubUrl,
                      resumeUrl,
                      h.rank,
                      h.score,
                      skill,
                      alreadyKnown,
                    ]
                  );

                  if (!alreadyKnown) {
                    newItems.push({
                      hacker: h.hacker,
                      name: profile.name ?? null,
                      website,
                      linkedinUrl,
                      githubUrl,
                      resumeUrl,
                    });
                  }
                } catch (err) {
                  failures.push(`${h.hacker}: ${(err as Error).message}`);
                }
              })
            );
          }

          send("progress", {
            phase: "scanning",
            scanId,
            page,
            endPage,
            scanned,
            matched: matchedTotal,
            alreadyInDb,
            alreadyInRecords: alreadyInRecordsCount,
          });

          await pool.query(
            `UPDATE hackerrank_scans
             SET current_page = $1, scanned = $2, matched = $3, already_in_db = $4,
                 already_in_records = $5, updated_at = now()
             WHERE id = $6`,
            [page, scanned, matchedTotal, alreadyInDb, alreadyInRecordsCount, scanId]
          );

          // Being a courteous, unauthenticated caller to the profile
          // endpoint across many pages — a short pause between pages only.
          if (page < endPage) await sleep(300);
        }

        await pool.query(
          `UPDATE hackerrank_scans SET status = 'completed', error_message = NULL, updated_at = now() WHERE id = $1`,
          [scanId]
        );

        send("done", {
          scanId,
          scanned,
          matched: matchedTotal,
          alreadyInDb,
          alreadyInRecords: alreadyInRecordsCount,
          failures,
          items: newItems,
        });
      } catch (err) {
        if (scanId) {
          await pool
            .query(`UPDATE hackerrank_scans SET error_message = $1, updated_at = now() WHERE id = $2`, [
              (err as Error).message,
              scanId,
            ])
            .catch(() => {});
        }
        if (err instanceof HackerRankError) {
          send("error", { scanId, message: err.message });
        } else {
          send("error", { scanId, message: (err as Error).message });
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
