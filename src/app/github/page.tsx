"use client";

import { useEffect, useRef, useState } from "react";
import VeeProfilePanel from "@/components/VeeProfilePanel";
import type { VeeProfileData } from "@/lib/veeProfileData";
import { buildVeeApplyContent } from "@/lib/veeProfileFormat";

const MAX_AUTO_RESUME_ATTEMPTS = 5;
const GENERIC_RETRY_BASE_MS = 30000;
const GENERIC_RETRY_MAX_MS = 120000;

type GithubUser = {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  score: number;
  email: string;
  location: string | null;
  linkedinUrl: string | null;
  linkedinVerified: boolean | null;
  lastPushedAt: string | null;
};

type SearchResult = {
  totalCount: number;
  incompleteResults: boolean;
  incompleteWindows: number;
  cutoffDate: string;
  windowsScanned: number;
  alreadyInDb: number;
  alreadyInBraintrust: number;
  checkedNew: number;
  withEmail: number;
  alreadyInRecords: number;
  items: GithubUser[];
};

type Progress =
  | { phase: "resuming"; searchId: number; location: string; years: number; windowsFound: number }
  | { phase: "planning"; windowsFound: number; matchesFound: number }
  | {
      phase: "checking";
      window: number;
      totalWindows: number;
      page: number;
      totalPagesInWindow: number;
      checkedNew: number;
      withEmail: number;
      alreadyInDb: number;
      alreadyInBraintrust: number;
    };

type SearchHistoryItem = {
  id: number;
  location: string;
  years: number;
  status: string;
  total_count: number;
  already_in_db: number;
  already_in_braintrust: number;
  checked_new: number;
  with_email: number;
  already_in_records: number;
  current_window: number;
  current_page: number;
  total_windows: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type SavedGithubUser = {
  id: number;
  name: string | null;
  github_link: string;
  email: string | null;
  avatar_url: string | null;
  location: string | null;
  already_in_records: boolean;
  linkedin_url: string | null;
  linkedin_verified: boolean | null;
  applied: boolean;
  applied_at: string | null;
  ignored: boolean;
  created_at: string;
  account_created_at: string | null;
  last_pushed_at: string | null;
  public_repos: number | null;
  followers: number | null;
  total_stars: number | null;
  bio: string | null;
  company: string | null;
  primary_language: string | null;
  is_likely_authentic: boolean | null;
};

type SavedListPage = {
  items: SavedGithubUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const RESULTS_PER_PAGE = 20;

function loadHistory(): Promise<SearchHistoryItem[]> {
  return fetch("/api/github/searches").then((res) => {
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    return res.json();
  });
}

function loadSavedList(
  page: number,
  showIgnored: boolean,
  hideApplied: boolean
): Promise<SavedListPage> {
  const params = new URLSearchParams({ page: String(page) });
  if (showIgnored) params.set("showIgnored", "true");
  if (hideApplied) params.set("hideApplied", "true");
  return fetch(`/api/github/list?${params}`).then((res) => {
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    return res.json();
  });
}

export default function GithubSearchPage() {
  const [location, setLocation] = useState("");
  const [years, setYears] = useState("10");
  const [requireLinkedin, setRequireLinkedin] = useState(false);
  const [requireActiveLastYear, setRequireActiveLastYear] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [resultsPage, setResultsPage] = useState(1);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);

  const [savedList, setSavedList] = useState<SavedListPage | null>(null);
  const [savedListLoading, setSavedListLoading] = useState(true);
  const [showIgnored, setShowIgnored] = useState(false);
  const [hideApplied, setHideApplied] = useState(true);
  const [selectedLinkedinUrl, setSelectedLinkedinUrl] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applyStatus, setApplyStatus] = useState<Record<string, "saving" | "done" | "error">>({});
  const [applyErrors, setApplyErrors] = useState<Record<string, string>>({});
  const [copiedLinkedinUrl, setCopiedLinkedinUrl] = useState<string | null>(null);

  const autoResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoResumeAttemptsRef = useRef(0);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (autoResumeTimerRef.current) clearTimeout(autoResumeTimerRef.current);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    loadHistory()
      .then(setHistory)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setSavedListLoading(true);
    loadSavedList(1, showIgnored, hideApplied)
      .then(setSavedList)
      .catch(() => {})
      .finally(() => setSavedListLoading(false));
  }, [showIgnored, hideApplied]);

  function refreshHistory() {
    loadHistory()
      .then(setHistory)
      .catch(() => {});
  }

  function refreshSavedList(page: number) {
    setSavedListLoading(true);
    return loadSavedList(page, showIgnored, hideApplied)
      .then(setSavedList)
      .catch(() => {})
      .finally(() => setSavedListLoading(false));
  }

  async function handleDeleteHistory(id: number) {
    const ok = window.confirm("Delete this search history entry? This cannot be undone.");
    if (!ok) return;
    try {
      const res = await fetch(`/api/github/searches/${id}`, { method: "DELETE" });
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
    setResultsPage(1);

    const es = new EventSource(`/api/github/search-users?${params}`);

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
    });

    es.addEventListener("error", (event) => {
      const messageEvent = event as MessageEvent;
      const parsed: {
        searchId?: number;
        message?: string;
        rateLimited?: boolean;
        resetAt?: string;
      } | null = messageEvent.data ? JSON.parse(messageEvent.data) : null;
      const baseMessage = parsed?.message ?? "Connection to the server was lost";

      setLoading(false);
      setProgress(null);
      es.close();
      refreshHistory();

      if (parsed?.searchId == null) {
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

      const delayMs =
        parsed.rateLimited && parsed.resetAt
          ? Math.max(0, new Date(parsed.resetAt).getTime() - Date.now()) + 5000
          : Math.min(GENERIC_RETRY_BASE_MS * attempt, GENERIC_RETRY_MAX_MS);
      const resumeAt = new Date(Date.now() + delayMs);
      const searchId = parsed.searchId;

      setError(
        `${baseMessage} Auto-resuming at ${resumeAt.toLocaleTimeString()} (attempt ${attempt} of ${MAX_AUTO_RESUME_ATTEMPTS})...`
      );

      autoResumeTimerRef.current = setTimeout(() => {
        autoResumeTimerRef.current = null;
        handleResume(searchId);
      }, delayMs);
    });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    startStream(
      new URLSearchParams({
        location,
        years,
        requireLinkedin: String(requireLinkedin),
        requireActiveLastYear: String(requireActiveLastYear),
      })
    );
  }

  function handleResume(id: number) {
    startStream(new URLSearchParams({ resumeId: String(id) }));
  }

  async function handleCopyLinkedin(linkedinUrl: string) {
    try {
      await navigator.clipboard.writeText(linkedinUrl);
    } catch {
      // Clipboard access can fail (permissions, insecure context) — the
      // "Copied" feedback below is best-effort either way.
    }
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setCopiedLinkedinUrl(linkedinUrl);
    copiedTimerRef.current = setTimeout(() => setCopiedLinkedinUrl(null), 1500);
  }

  async function handleCopyAndApplied(
    linkedinUrl: string,
    email: string | null,
    removeFromView: () => void
  ) {
    setApplyStatus((prev) => ({ ...prev, [linkedinUrl]: "saving" }));
    setApplyErrors((prev) => {
      const next = { ...prev };
      delete next[linkedinUrl];
      return next;
    });

    // Check records first, before spending a Vee lookup credit — if this
    // candidate is already known, there's nothing else to do here except
    // get them out of view.
    try {
      const checkRes = await fetch("/api/check-or-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email ?? "", link: linkedinUrl, onlySearch: true }),
      });
      const checkBody = await checkRes.json();
      if (!checkRes.ok) throw new Error(checkBody.error || `request failed (${checkRes.status})`);
      if (checkBody.exists) {
        removeFromView();
        return;
      }
    } catch (err) {
      setApplyStatus((prev) => ({ ...prev, [linkedinUrl]: "error" }));
      setApplyErrors((prev) => ({ ...prev, [linkedinUrl]: (err as Error).message }));
      return;
    }

    try {
      const res = await fetch(`/api/vee-profile?url=${encodeURIComponent(linkedinUrl)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
      const profile = body as VeeProfileData;
      const content = buildVeeApplyContent(profile);

      try {
        await navigator.clipboard.writeText(content);
      } catch {
        // Clipboard access can fail (permissions, insecure context) — still
        // log it to working history even if the copy itself didn't work.
      }

      // Save the linkedinUrl we already had on file (matches github_us),
      // not profile.common.url — Vee returns its own current canonical URL
      // for the profile, which can use a different vanity slug than what
      // was originally stored, so matching on it would silently fail.
      const saveRes = await fetch("/api/working-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          linkedinUrl,
          content,
          source: "github",
          name: profile.common.full_name,
        }),
      });
      if (!saveRes.ok) {
        const saveBody = await saveRes.json();
        throw new Error(saveBody.error || `request failed (${saveRes.status})`);
      }
      setApplyStatus((prev) => ({ ...prev, [linkedinUrl]: "done" }));
    } catch (err) {
      setApplyStatus((prev) => ({ ...prev, [linkedinUrl]: "error" }));
      setApplyErrors((prev) => ({ ...prev, [linkedinUrl]: (err as Error).message }));
    }
  }

  async function handleIgnore(id: number, ignore: boolean) {
    try {
      const res = await fetch(`/api/github/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: ignore ? "ignore" : "unignore" }),
      });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      await refreshSavedList(savedList?.page ?? 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <div className="flex flex-1 justify-center">
      <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            GitHub Search
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Find GitHub users by location whose account is older than a
            given number of years (a proxy for experience). Matches with a
            findable email are saved to the github table.
          </p>
        </div>

        <form
          onSubmit={handleSearch}
          className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
        >
          <div className="flex items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Location
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. FL"
                disabled={loading}
                className="w-32 rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900 disabled:opacity-50"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Min. years old
              <input
                type="number"
                value={years}
                onChange={(e) => setYears(e.target.value)}
                min={1}
                disabled={loading}
                className="w-28 rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900 disabled:opacity-50"
              />
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-sm">
              <input
                type="checkbox"
                checked={requireLinkedin}
                onChange={(e) => setRequireLinkedin(e.target.checked)}
                disabled={loading}
              />
              Only include users with a LinkedIn link
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-sm">
              <input
                type="checkbox"
                checked={requireActiveLastYear}
                onChange={(e) => setRequireActiveLastYear(e.target.checked)}
                disabled={loading}
              />
              Only include users active in the last year
            </label>
            <button
              type="submit"
              disabled={loading || !location.trim()}
              className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
            >
              {loading && (
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/40 border-t-background"
                />
              )}
              {loading ? "Searching..." : "Search"}
            </button>
          </div>
          {progress && (
            <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-black/[.02] px-3 py-2 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400">
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-400/40 border-t-zinc-500 dark:border-zinc-500/40 dark:border-t-zinc-300"
              />
              {progress.phase === "resuming" &&
                `Resuming search for "${progress.location}" (${progress.years}+ years) — ${progress.windowsFound} date window(s) already mapped out.`}
              {progress.phase === "planning" &&
                `Splitting the date range so every part stays under GitHub's 1,000-result cap — ${progress.windowsFound} window${progress.windowsFound === 1 ? "" : "s"} found so far, ${progress.matchesFound.toLocaleString()} matches covered.`}
              {progress.phase === "checking" &&
                `Window ${progress.window} of ${progress.totalWindows}, page ${progress.page} of ${progress.totalPagesInWindow} — ${progress.checkedNew} new accounts checked, ${progress.withEmail} found so far (${progress.alreadyInDb} already in database, ${progress.alreadyInBraintrust} already in Braintrust).`}
            </div>
          )}

          {error && (
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              Error: {error}
            </p>
          )}
        </form>

        {result && (
          <>
            <div>
              <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Results for &quot;{location}&quot; ({years}+ years), created
                before {result.cutoffDate}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Total matches" value={result.totalCount.toLocaleString()} />
                <Stat label="Date windows scanned" value={result.windowsScanned.toLocaleString()} />
                <Stat label="Already in database" value={result.alreadyInDb.toLocaleString()} />
                <Stat
                  label="Already a Braintrust freelancer"
                  value={result.alreadyInBraintrust.toLocaleString()}
                />
                <Stat label="New accounts checked" value={result.checkedNew.toLocaleString()} />
                <Stat label="Saved with an email" value={result.withEmail.toLocaleString()} />
                <Stat
                  label="Already in your records"
                  value={result.alreadyInRecords.toLocaleString()}
                />
                <Stat
                  label="Shown below"
                  value={(result.withEmail - result.alreadyInRecords).toLocaleString()}
                />
              </div>
              {(result.incompleteResults || result.incompleteWindows > 0) && (
                <p className="mt-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                  {result.incompleteResults &&
                    "Results incomplete — try a narrower query. "}
                  {result.incompleteWindows > 0 &&
                    `${result.incompleteWindows} date window(s) still had over 1,000 matches on a single day and were only partially covered.`}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              {result.items
                .slice((resultsPage - 1) * RESULTS_PER_PAGE, resultsPage * RESULTS_PER_PAGE)
                .map((user) => (
                <a
                  key={user.login}
                  href={user.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 rounded-lg border border-black/10 p-3 text-sm hover:bg-black/[.02] dark:border-white/10 dark:hover:bg-white/[.03]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={user.avatarUrl}
                    alt=""
                    width={32}
                    height={32}
                    className="rounded-full"
                  />
                  <div className="flex flex-1 flex-col">
                    <span className="font-medium text-black dark:text-zinc-50">
                      {user.name || user.login}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {user.email}
                      {user.location && ` · ${user.location}`}
                      {user.linkedinUrl && (
                        <>
                          {" · "}
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleCopyLinkedin(user.linkedinUrl as string);
                            }}
                            className="text-blue-600 underline dark:text-blue-400"
                          >
                            {copiedLinkedinUrl === user.linkedinUrl
                              ? "Copied ✓"
                              : `LinkedIn${user.linkedinVerified ? " ✓" : ""}`}
                          </button>
                        </>
                      )}
                      {user.lastPushedAt &&
                        ` · last active ${new Date(user.lastPushedAt).toLocaleDateString()}`}
                    </span>
                    {user.linkedinUrl &&
                      applyStatus[user.linkedinUrl] === "error" &&
                      applyErrors[user.linkedinUrl] && (
                        <span className="mt-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
                          {applyErrors[user.linkedinUrl]}
                        </span>
                      )}
                  </div>
                  {user.linkedinUrl && (
                    <div className="ml-auto flex shrink-0 items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedLinkedinUrl(user.linkedinUrl);
                          setSelectedEmail(user.email);
                          setSelectedId(null);
                        }}
                        className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-white/15 dark:text-zinc-400"
                      >
                        View
                      </button>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const linkedinUrl = user.linkedinUrl as string;
                          handleCopyAndApplied(linkedinUrl, user.email, () =>
                            setResult((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    items: prev.items.filter((x) => x.linkedinUrl !== linkedinUrl),
                                  }
                                : prev
                            )
                          );
                        }}
                        disabled={applyStatus[user.linkedinUrl as string] === "saving"}
                        className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                      >
                        {applyStatus[user.linkedinUrl as string] === "saving"
                          ? "Saving..."
                          : applyStatus[user.linkedinUrl as string] === "done"
                            ? "Copied & Saved ✓"
                            : "Copy and Applied"}
                      </button>
                    </div>
                  )}
                </a>
              ))}
              {result.items.length === 0 && (
                <p className="text-sm text-zinc-500">
                  No results with a findable email.
                </p>
              )}
            </div>

            {result.items.length > RESULTS_PER_PAGE && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">
                  Page {resultsPage} of{" "}
                  {Math.ceil(result.items.length / RESULTS_PER_PAGE)} (
                  {result.items.length} saved this search)
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setResultsPage((p) => p - 1)}
                    disabled={resultsPage <= 1}
                    className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium dark:border-white/15 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => setResultsPage((p) => p + 1)}
                    disabled={
                      resultsPage >= Math.ceil(result.items.length / RESULTS_PER_PAGE)
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
                      {h.location}{" "}
                      <span className="font-normal text-zinc-500">
                        ({h.years}+ years)
                      </span>
                    </div>
                    <div className="text-xs text-zinc-500">
                      {h.status === "completed"
                        ? `Completed — ${h.with_email} saved with email, ${h.already_in_db} already known, ${h.already_in_braintrust} already a Braintrust freelancer, out of ${h.total_count.toLocaleString()} total matches.`
                        : `In progress — window ${h.current_window + 1} of ${h.total_windows || "?"}, page ${h.current_page}. ${h.with_email} saved so far.`}
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

        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Saved GitHub Users
            </h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
                <input
                  type="checkbox"
                  checked={hideApplied}
                  onChange={(e) => setHideApplied(e.target.checked)}
                />
                Hide copied
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

          {savedListLoading && <p className="text-sm text-zinc-500">Loading...</p>}

          {savedList && (
            <>
              <div className="flex flex-col gap-2">
                {savedList.items.map((u) => (
                  <div
                    key={u.id}
                    className={`flex items-center gap-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10 ${
                      u.ignored ? "opacity-50" : ""
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u.avatar_url ?? ""}
                      alt=""
                      width={32}
                      height={32}
                      className="rounded-full bg-black/10 dark:bg-white/10"
                    />
                    <div className="flex flex-1 flex-col">
                      <a
                        href={u.github_link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-black underline dark:text-zinc-50"
                      >
                        {u.name || u.github_link}
                      </a>
                      <span className="text-xs text-zinc-500">
                        {u.email ?? "no email"}
                        {u.location && ` · ${u.location}`}
                        {u.primary_language && ` · ${u.primary_language}`}
                        {u.last_pushed_at &&
                          ` · last active ${new Date(u.last_pushed_at).toLocaleDateString()}`}
                        {u.is_likely_authentic === false && " · flagged inauthentic"}
                        {u.ignored && " · ignored"}
                        {u.linkedin_url && (
                          <>
                            {" · "}
                            <button
                              onClick={() => handleCopyLinkedin(u.linkedin_url as string)}
                              className="text-blue-600 underline dark:text-blue-400"
                            >
                              {copiedLinkedinUrl === u.linkedin_url
                                ? "Copied ✓"
                                : `LinkedIn${u.linkedin_verified ? " ✓" : ""}`}
                            </button>
                          </>
                        )}
                      </span>
                      {u.linkedin_url &&
                        applyStatus[u.linkedin_url] === "error" &&
                        applyErrors[u.linkedin_url] && (
                          <span className="mt-0.5 text-[11px] font-medium text-red-600 dark:text-red-400">
                            {applyErrors[u.linkedin_url]}
                          </span>
                        )}
                    </div>
                    <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {u.linkedin_url && (
                        <>
                          <button
                            onClick={() => {
                              setSelectedLinkedinUrl(u.linkedin_url);
                              setSelectedEmail(u.email);
                              setSelectedId(u.id);
                            }}
                            className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-white/15 dark:text-zinc-400"
                          >
                            View
                          </button>
                          <button
                            onClick={() =>
                              handleCopyAndApplied(u.linkedin_url as string, u.email, () =>
                                handleIgnore(u.id, true)
                              )
                            }
                            disabled={
                              u.applied || applyStatus[u.linkedin_url as string] === "saving"
                            }
                            className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                          >
                            {u.applied || applyStatus[u.linkedin_url as string] === "done"
                              ? "Copied & Saved ✓"
                              : applyStatus[u.linkedin_url as string] === "saving"
                                ? "Saving..."
                                : "Copy and Applied"}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleIgnore(u.id, !u.ignored)}
                        className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-white/15 dark:text-zinc-400"
                      >
                        {u.ignored ? "Unignore" : "Ignore"}
                      </button>
                    </div>
                  </div>
                ))}
                {savedList.items.length === 0 && (
                  <p className="text-sm text-zinc-500">Nothing saved yet.</p>
                )}
              </div>

              {savedList.total > 0 && (
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span className="text-zinc-500">
                    Page {savedList.page} of {savedList.totalPages} (
                    {savedList.total.toLocaleString()} saved)
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => refreshSavedList(savedList.page - 1)}
                      disabled={savedList.page <= 1 || savedListLoading}
                      className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium dark:border-white/15 disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      onClick={() => refreshSavedList(savedList.page + 1)}
                      disabled={savedList.page >= savedList.totalPages || savedListLoading}
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
            email={selectedEmail}
            source="github"
            onClose={() => {
              setSelectedLinkedinUrl(null);
              setSelectedEmail(null);
              setSelectedId(null);
            }}
            onAlreadyExists={() => {
              if (selectedId != null) {
                handleIgnore(selectedId, true);
              } else {
                setResult((prev) =>
                  prev
                    ? {
                        ...prev,
                        items: prev.items.filter((x) => x.linkedinUrl !== selectedLinkedinUrl),
                      }
                    : prev
                );
              }
              setSelectedLinkedinUrl(null);
              setSelectedEmail(null);
              setSelectedId(null);
            }}
          />
        </aside>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-black/10 p-3 dark:border-white/10">
      <div className="text-lg font-semibold text-black dark:text-zinc-50">
        {value}
      </div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  );
}
