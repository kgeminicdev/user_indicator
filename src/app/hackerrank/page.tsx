"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import VeeProfilePanel from "@/components/VeeProfilePanel";
import { notify } from "@/components/Toast";

const MAX_AUTO_RESUME_ATTEMPTS = 5;
const GENERIC_RETRY_BASE_MS = 30000;
const GENERIC_RETRY_MAX_MS = 120000;

type NewItem = {
  hacker: string;
  name: string | null;
  website: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  resumeUrl: string | null;
};

type ScanDone = {
  scanId: number;
  scanned: number;
  matched: number;
  alreadyInDb: number;
  alreadyInRecords: number;
  failures: string[];
  items: NewItem[];
};

type Progress =
  | { phase: "resuming"; scanId: number; skill: string; endPage: number; currentPage: number }
  | { phase: "planning"; scanId: number; skill: string; totalUsers: number; totalPages: number }
  | {
      phase: "scanning";
      scanId: number;
      page: number;
      endPage: number;
      scanned: number;
      matched: number;
      alreadyInDb: number;
      alreadyInRecords: number;
    };

type ScanHistoryItem = {
  id: number;
  skill: string;
  start_page: number;
  end_page: number;
  current_page: number;
  status: string;
  scanned: number;
  matched: number;
  already_in_db: number;
  already_in_records: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type SavedMatch = {
  id: number;
  hacker: string;
  hacker_id: number | null;
  name: string | null;
  website: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  resume_url: string | null;
  rank: number | null;
  score: number | null;
  skill: string | null;
  already_in_records: boolean;
  added_to_todo: boolean;
  ignored: boolean;
  created_at: string;
};

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

type SavedMatchesPage = {
  items: SavedMatch[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function loadHistory(): Promise<ScanHistoryItem[]> {
  return fetch("/api/hackerrank/searches").then((res) => {
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    return res.json();
  });
}

function loadSavedMatches(
  page: number,
  showIgnored: boolean,
  showAdded: boolean,
  skillFilter: string
): Promise<SavedMatchesPage> {
  const params = new URLSearchParams({ page: String(page) });
  if (showIgnored) params.set("showIgnored", "true");
  if (showAdded) params.set("showAdded", "true");
  if (skillFilter) params.set("skill", skillFilter);
  return fetch(`/api/hackerrank/matches?${params}`).then((res) => {
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    return res.json();
  });
}

export default function HackerRankPage() {
  const [skill, setSkill] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanDone | null>(null);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);

  const [savedMatches, setSavedMatches] = useState<SavedMatchesPage | null>(null);
  const [savedMatchesLoading, setSavedMatchesLoading] = useState(true);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addPromptId, setAddPromptId] = useState<number | null>(null);
  const [emailPromptValue, setEmailPromptValue] = useState("");
  const [linkedinPromptValue, setLinkedinPromptValue] = useState("");
  const [showIgnored, setShowIgnored] = useState(false);
  const [showAdded, setShowAdded] = useState(false);
  const [skillFilter, setSkillFilter] = useState("");
  const [selectedLinkedinUrl, setSelectedLinkedinUrl] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const autoResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoResumeAttemptsRef = useRef(0);

  useEffect(() => {
    return () => {
      if (autoResumeTimerRef.current) clearTimeout(autoResumeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    loadHistory()
      .then(setHistory)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSavedMatches(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showIgnored, showAdded, skillFilter]);

  function refreshHistory() {
    loadHistory()
      .then(setHistory)
      .catch(() => {});
  }

  function refreshSavedMatches(page: number) {
    setSavedMatchesLoading(true);
    return loadSavedMatches(page, showIgnored, showAdded, skillFilter)
      .then(setSavedMatches)
      .catch(() => {})
      .finally(() => setSavedMatchesLoading(false));
  }

  async function handleIgnore(id: number, ignore: boolean) {
    try {
      const res = await fetch(`/api/hackerrank/matches/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: ignore ? "ignore" : "unignore" }),
      });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      await refreshSavedMatches(savedMatches?.page ?? 1);
    } catch (err) {
      notify(`Error ${ignore ? "ignoring" : "unignoring"}: ${(err as Error).message}`, "error");
    }
  }

  function handleViewClick(m: SavedMatch, linkedinUrl: string) {
    setSelectedLinkedinUrl(linkedinUrl);
    setSelectedId(m.id);
  }

  function handleAddClick(m: SavedMatch) {
    setAddPromptId(m.id);
    setEmailPromptValue("");
    setLinkedinPromptValue(m.linkedin_url ?? "");
  }

  function submitAddPrompt(m: SavedMatch) {
    const email = emailPromptValue.trim();
    const linkedinUrl = linkedinPromptValue.trim();
    if (!isValidEmail(email) || !linkedinUrl) return;
    setAddPromptId(null);
    handleAddToTodo(m, email, linkedinUrl);
  }

  // LinkedIn is required — content is fetched from the actual profile (same
  // as GitHub/Braintrust), not built from the HackerRank fields alone.
  // No profile fetch here — content is filled in later (background refill
  // job or the To Do tab's "Get content" button), so Add to To Do doesn't
  // block on a slow, proxy-dependent Vee lookup.
  async function handleAddToTodo(m: SavedMatch, email: string, linkedinUrl: string) {
    setAddingId(m.id);
    try {
      const name = m.name || m.hacker;

      const res = await fetch("/api/todo-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          link: linkedinUrl,
          content: null,
          source: "hackerrank",
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
      notify(
        body.exists ? `Already in records: ${name}` : `Added to To Do: ${name}`,
        "success"
      );
      // Copy, don't move — the hackerrank_matches row stays, just hidden
      // from the default view (same as GitHub's ignore-on-apply).
      await handleIgnore(m.id, true);
    } catch (err) {
      notify(`Error adding: ${(err as Error).message}`, "error");
    } finally {
      setAddingId(null);
    }
  }

  async function handleDeleteHistory(id: number) {
    const ok = window.confirm("Delete this scan history entry? This cannot be undone.");
    if (!ok) return;
    try {
      const res = await fetch(`/api/hackerrank/searches/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      refreshHistory();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function startStream(params: URLSearchParams) {
    if (autoResumeTimerRef.current) {
      clearTimeout(autoResumeTimerRef.current);
      autoResumeTimerRef.current = null;
    }

    setLoading(true);
    setProgress(null);
    setError(null);
    setResult(null);

    const es = new EventSource(`/api/hackerrank/scan?${params}`);

    es.addEventListener("progress", (event) => {
      setProgress(JSON.parse(event.data));
    });

    es.addEventListener("done", (event) => {
      autoResumeAttemptsRef.current = 0;
      setResult(JSON.parse(event.data));
      setLoading(false);
      setProgress(null);
      es.close();
      refreshHistory();
      refreshSavedMatches(1);
    });

    es.addEventListener("error", (event) => {
      const messageEvent = event as MessageEvent;
      const parsed: { scanId?: number; message?: string } | null = messageEvent.data
        ? JSON.parse(messageEvent.data)
        : null;
      const baseMessage = parsed?.message ?? "Connection to the server was lost";

      setLoading(false);
      setProgress(null);
      es.close();
      refreshHistory();

      if (parsed?.scanId == null) {
        setError(baseMessage);
        return;
      }

      if (autoResumeAttemptsRef.current >= MAX_AUTO_RESUME_ATTEMPTS) {
        setError(
          `${baseMessage} Gave up auto-resuming after ${MAX_AUTO_RESUME_ATTEMPTS} attempts — click Resume below to try again.`
        );
        autoResumeAttemptsRef.current = 0;
        return;
      }

      const attempt = autoResumeAttemptsRef.current + 1;
      autoResumeAttemptsRef.current = attempt;

      const delayMs = Math.min(GENERIC_RETRY_BASE_MS * attempt, GENERIC_RETRY_MAX_MS);
      const resumeAt = new Date(Date.now() + delayMs);
      const scanId = parsed.scanId;

      setError(
        `${baseMessage} Auto-resuming at ${resumeAt.toLocaleTimeString()} (attempt ${attempt} of ${MAX_AUTO_RESUME_ATTEMPTS})...`
      );

      autoResumeTimerRef.current = setTimeout(() => {
        autoResumeTimerRef.current = null;
        handleResume(scanId);
      }, delayMs);
    });
  }

  function handleScan(e: React.FormEvent) {
    e.preventDefault();
    startStream(new URLSearchParams({ skill }));
  }

  function handleResume(id: number) {
    startStream(new URLSearchParams({ resumeId: String(id) }));
  }

  const knownSkills = Array.from(new Set(history.map((h) => h.skill))).sort();

  return (
    <div className="flex min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <div className="flex flex-1 justify-center">
      <main className="flex w-full max-w-4xl flex-col gap-8 py-16 px-6">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            HackerRank
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Scans the entire practice leaderboard (level 5, United States) for a skill track,
            page by page, and saves anyone with a verified LinkedIn, a valid website/GitHub link,
            or a visible resume. Resumable — safe to stop and continue later, however many pages
            it takes.
          </p>
        </div>

        <form
          onSubmit={handleScan}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
        >
          <label className="flex flex-col gap-1 text-sm">
            Skill (track)
            <input
              type="text"
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              placeholder="e.g. python"
              disabled={loading}
              className="w-48 rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900 disabled:opacity-50"
            />
          </label>
          <button
            type="submit"
            disabled={loading || !skill.trim()}
            className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            {loading && (
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/40 border-t-background"
              />
            )}
            {loading ? "Scanning..." : "Scan"}
          </button>
        </form>

        {progress && (
          <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-black/[.02] px-3 py-2 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400">
            <span
              aria-hidden
              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-400/40 border-t-zinc-500 dark:border-zinc-500/40 dark:border-t-zinc-300"
            />
            {progress.phase === "resuming"
              ? `Resuming scan #${progress.scanId} — ${progress.skill}, page ${progress.currentPage} of ${progress.endPage}...`
              : progress.phase === "planning"
                ? `${progress.skill} has ${progress.totalUsers.toLocaleString()} users across ${progress.totalPages.toLocaleString()} pages — starting scan...`
                : `Page ${progress.page} of ${progress.endPage} — ${progress.scanned} checked, ${progress.matched} new leads, ${progress.alreadyInDb} already known, ${progress.alreadyInRecords} already in records.`}
          </div>
        )}

        {error && (
          <p className="text-sm font-medium text-red-600 dark:text-red-400">Error: {error}</p>
        )}

        {result && (
          <div>
            <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Scan complete — {result.matched} new leads, {result.alreadyInDb} already known,{" "}
              {result.alreadyInRecords} already in records, out of {result.scanned} checked
              {result.failures.length > 0 && ` (${result.failures.length} profile lookups failed)`}
            </h2>
          </div>
        )}

        {history.length > 0 && (
          <div>
            <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Search History
            </h2>
            <div className="flex flex-col gap-2">
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex flex-col gap-2 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="font-medium text-black dark:text-zinc-50">
                      {h.skill}{" "}
                      <span className="font-normal text-zinc-500">
                        ({h.end_page.toLocaleString()} pages total)
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500">
                      {h.status === "completed"
                        ? `Completed — ${h.matched} new leads, ${h.already_in_db} already known, ${h.already_in_records} already in records, out of ${h.scanned} checked.`
                        : `In progress — page ${h.current_page} of ${h.end_page}. ${h.matched} new leads so far.`}
                      {h.error_message && ` Last stopped: ${h.error_message}`}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {h.status !== "completed" && (
                      <button
                        onClick={() => handleResume(h.id)}
                        disabled={loading}
                        className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                      >
                        Resume
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteHistory(h.id)}
                      className="rounded-full border border-red-300 px-4 py-1.5 text-xs font-medium text-red-600 dark:border-red-900 dark:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Saved Matches
            </h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                Skill
                <select
                  value={skillFilter}
                  onChange={(e) => setSkillFilter(e.target.value)}
                  className="rounded border border-black/15 px-2 py-1 text-xs dark:border-white/15 dark:bg-zinc-900"
                >
                  <option value="">All skills</option>
                  {knownSkills.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={showAdded}
                  onChange={(e) => setShowAdded(e.target.checked)}
                />
                Show added to To Do
              </label>
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={showIgnored}
                  onChange={(e) => setShowIgnored(e.target.checked)}
                />
                Show ignored
              </label>
            </div>
          </div>

          {savedMatchesLoading && <p className="text-sm text-zinc-500">Loading...</p>}

          {savedMatches && (
            <>
              <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-black/10 bg-black/[.02] text-xs text-zinc-500 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">Hacker</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">Name</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">Skill</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">Website</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">LinkedIn</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">GitHub</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">Resume</th>
                      <th className="whitespace-nowrap px-3 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedMatches.items.map((m) => (
                      <Fragment key={m.id}>
                      <tr
                        className={`border-b border-black/5 last:border-0 dark:border-white/5 ${
                          m.ignored ? "opacity-50" : ""
                        }`}
                      >
                        <td className="px-3 py-2">
                          <a
                            href={`https://www.hackerrank.com/${m.hacker}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline dark:text-blue-400"
                          >
                            {m.hacker}
                          </a>
                        </td>
                        <td className="px-3 py-2">{m.name ?? "—"}</td>
                        <td className="px-3 py-2 text-zinc-500">{m.skill ?? "—"}</td>
                        <td className="px-3 py-2">
                          {m.website ? (
                            <a
                              href={m.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline dark:text-blue-400"
                            >
                              Website
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {m.linkedin_url ? (
                            <a
                              href={m.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline dark:text-blue-400"
                            >
                              LinkedIn
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {m.github_url ? (
                            <a
                              href={m.github_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline dark:text-blue-400"
                            >
                              GitHub
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {m.resume_url ? (
                            <a
                              href={m.resume_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline dark:text-blue-400"
                            >
                              Resume
                            </a>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-nowrap items-center gap-1.5">
                            {m.linkedin_url ? (
                              <button
                                onClick={() => handleViewClick(m, m.linkedin_url as string)}
                                className="whitespace-nowrap rounded-full border border-black/15 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:border-white/15 dark:text-zinc-400"
                              >
                                View
                              </button>
                            ) : (
                              <span
                                aria-hidden
                                className="invisible whitespace-nowrap rounded-full border border-black/15 px-2.5 py-1.5 text-xs font-medium"
                              >
                                View
                              </span>
                            )}
                            <button
                              onClick={() => handleAddClick(m)}
                              disabled={
                                addingId === m.id || m.already_in_records || m.added_to_todo
                              }
                              className="whitespace-nowrap rounded-full bg-foreground px-2.5 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                            >
                              {addingId === m.id
                                ? "Adding..."
                                : m.already_in_records
                                  ? "Already in Records"
                                  : m.added_to_todo
                                    ? "Added ✓"
                                    : "Add to To Do"}
                            </button>
                            <button
                              onClick={() => handleIgnore(m.id, !m.ignored)}
                              className="whitespace-nowrap rounded-full border border-black/15 px-2.5 py-1.5 text-xs font-medium text-zinc-600 dark:border-white/15 dark:text-zinc-400"
                            >
                              {m.ignored ? "Unignore" : "Ignore"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {addPromptId === m.id && (
                        <tr className="border-b border-black/5 bg-black/[.02] dark:border-white/5 dark:bg-white/[.03]">
                          <td colSpan={8} className="px-3 py-3">
                            <div className="flex flex-wrap items-end gap-3">
                              <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                                Email (required)
                                <input
                                  type="email"
                                  autoFocus
                                  value={emailPromptValue}
                                  onChange={(e) => setEmailPromptValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") setAddPromptId(null);
                                  }}
                                  placeholder="candidate@example.com"
                                  className="w-56 rounded border border-black/15 px-2 py-1.5 text-xs dark:border-white/15 dark:bg-zinc-900"
                                />
                              </label>
                              <label className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400">
                                LinkedIn link (required)
                                <input
                                  type="text"
                                  value={linkedinPromptValue}
                                  onChange={(e) => setLinkedinPromptValue(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") submitAddPrompt(m);
                                    if (e.key === "Escape") setAddPromptId(null);
                                  }}
                                  placeholder="https://linkedin.com/in/..."
                                  className="w-64 rounded border border-black/15 px-2 py-1.5 text-xs dark:border-white/15 dark:bg-zinc-900"
                                />
                              </label>
                              <button
                                onClick={() => submitAddPrompt(m)}
                                disabled={
                                  !isValidEmail(emailPromptValue.trim()) ||
                                  !linkedinPromptValue.trim()
                                }
                                className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                              >
                                Continue
                              </button>
                              <button
                                onClick={() => setAddPromptId(null)}
                                className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium dark:border-white/15"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                {savedMatches.items.length === 0 && (
                  <p className="p-4 text-sm text-zinc-500">Nothing saved yet.</p>
                )}
              </div>

              {savedMatches.total > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">
                    Page {savedMatches.page} of {savedMatches.totalPages} (
                    {savedMatches.total.toLocaleString()} total)
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => refreshSavedMatches(savedMatches.page - 1)}
                      disabled={savedMatches.page <= 1 || savedMatchesLoading}
                      className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium dark:border-white/15 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => refreshSavedMatches(savedMatches.page + 1)}
                      disabled={
                        savedMatches.page >= savedMatches.totalPages || savedMatchesLoading
                      }
                      className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium dark:border-white/15 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      </div>
      {selectedLinkedinUrl && (
        <aside className="sticky top-0 h-screen w-1/2 shrink-0 overflow-y-auto border-l border-black/10 bg-white dark:border-white/10 dark:bg-zinc-950">
          <VeeProfilePanel
            profileUrl={selectedLinkedinUrl}
            email={null}
            source="hackerrank"
            onClose={() => {
              setSelectedLinkedinUrl(null);
              setSelectedId(null);
            }}
            onAlreadyExists={() => {
              setSelectedLinkedinUrl(null);
              refreshSavedMatches(savedMatches?.page ?? 1);
            }}
            onQueued={() => {
              // Copy, don't move — same as the row-level Add to To Do.
              if (selectedId != null) handleIgnore(selectedId, true);
            }}
          />
        </aside>
      )}
    </div>
  );
}
