"use client";

import { useEffect, useState } from "react";
import VeeProfilePanel from "@/components/VeeProfilePanel";
import { notify } from "@/components/Toast";

type ExternalProfile = { site: { name: string }; public_url: string };

type TodoItem = {
  id: number;
  braintrust_id: number;
  name: string | null;
  github_url: string | null;
  linkedin_url: string | null;
  linkedin_verified: boolean | null;
  external_profiles: ExternalProfile[] | null;
  derived_email: string | null;
  status: string;
  created_at: string;
};

type ScanResult = {
  scanned: number;
  alreadyMatched: number;
  missing: number;
  newlyQueued: number;
  alreadyQueued: number;
};

type TodoPageResult = {
  items: TodoItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function loadTodos(page: number): Promise<TodoPageResult> {
  return fetch(`/api/todo?page=${page}`).then((res) => {
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    return res.json();
  });
}

function resolveLinkedinUrl(item: TodoItem): string | null {
  return (
    item.linkedin_url ||
    item.external_profiles?.find((p) => p.site?.name === "LinkedIn")?.public_url ||
    null
  );
}

function resolveGithubUrl(item: TodoItem): string | null {
  return (
    item.github_url ||
    item.external_profiles?.find((p) => p.site?.name === "GitHub")?.public_url ||
    null
  );
}

// GitHub serves a user's avatar directly at this URL — no API call (and no
// rate limit) needed. `size` controls the resolution GitHub renders — small
// for the card thumbnail, much larger for the click-to-zoom lightbox.
function githubAvatarUrl(githubUrl: string | null, size: number = 64): string | null {
  if (!githubUrl) return null;
  try {
    const parsed = new URL(githubUrl);
    if (!parsed.hostname.includes("github.com")) return null;
    const [username] = parsed.pathname.split("/").filter(Boolean);
    return username ? `https://github.com/${username}.png?size=${size}` : null;
  } catch {
    return null;
  }
}

// Flat gray silhouette shown when there's no GitHub link, or the derived
// avatar URL turns out to be stale/deleted (404).
const DEFAULT_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 140">` +
      `<circle cx="70" cy="70" r="70" fill="#EBEBEB"/>` +
      `<circle cx="70" cy="52" r="26" fill="#BDBDBD"/>` +
      `<path d="M18 138c0-32.5 23.3-58.8 52-58.8s52 26.3 52 58.8" fill="#BDBDBD"/>` +
      `</svg>`
  );

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function BraintrustScanPage() {
  const [items, setItems] = useState<TodoItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [startId, setStartId] = useState("");
  const [endId, setEndId] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);

  const [selectedLinkedinUrl, setSelectedLinkedinUrl] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [applyStatus, setApplyStatus] = useState<Record<number, "saving" | "done" | "error">>({});
  const [applyErrors, setApplyErrors] = useState<Record<number, string>>({});

  // Braintrust candidates often have no derived email and/or no LinkedIn
  // link — Add to To Do requires both, so when either is missing this opens
  // an expanded row prompting for both together (same pattern as HackerRank).
  const [addPromptId, setAddPromptId] = useState<number | null>(null);
  const [emailPromptValue, setEmailPromptValue] = useState("");
  const [linkedinPromptValue, setLinkedinPromptValue] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [brokenAvatarIds, setBrokenAvatarIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!lightboxUrl) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setLightboxUrl(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightboxUrl]);

  function applyTodoPage(data: TodoPageResult) {
    setItems(data.items);
    setPage(data.page);
    setTotalPages(data.totalPages);
    setTotal(data.total);
  }

  function refresh(targetPage: number) {
    setLoading(true);
    return loadTodos(targetPage)
      .then(applyTodoPage)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadTodos(1)
      .then(applyTodoPage)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  async function deleteTodo(id: number) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/todo/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "action failed");
      }
      const nextPage = items.length === 1 && page > 1 ? page - 1 : page;
      await refresh(nextPage);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function handleDelete(item: TodoItem) {
    const ok = window.confirm(
      `Permanently delete ${item.name || "this candidate"}? This cannot be undone.`
    );
    if (!ok) return;
    deleteTodo(item.id);
  }

  async function handleAddToTodo(
    itemId: number,
    linkedinUrl: string,
    email: string,
    name: string | null,
    removeFromView: () => void
  ) {
    setApplyStatus((prev) => ({ ...prev, [itemId]: "saving" }));
    setApplyErrors((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });

    // Check records first, before spending a Vee lookup credit — if this
    // candidate is already known, there's nothing else to do here except
    // get them out of view.
    try {
      const checkRes = await fetch("/api/check-or-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, link: linkedinUrl, onlySearch: true }),
      });
      const checkBody = await checkRes.json();
      if (!checkRes.ok) throw new Error(checkBody.error || `request failed (${checkRes.status})`);
      if (checkBody.exists) {
        notify(`Already in records (${email || linkedinUrl}) — removed from view, nothing saved.`);
        removeFromView();
        return;
      }
    } catch (err) {
      notify(`Error checking records: ${(err as Error).message}`, "error");
      setApplyStatus((prev) => ({ ...prev, [itemId]: "error" }));
      setApplyErrors((prev) => ({ ...prev, [itemId]: (err as Error).message }));
      return;
    }

    // No profile fetch here — content is filled in later (background
    // refill job or the To Do tab's "Get content" button), so Add to To Do
    // doesn't block on a slow, proxy-dependent Vee lookup.
    try {
      const saveRes = await fetch("/api/todo-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || email || linkedinUrl,
          email,
          link: linkedinUrl,
          content: null,
          source: "braintrust",
        }),
      });
      const saveBody = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveBody.error || `request failed (${saveRes.status})`);
      if (saveBody.exists) {
        notify(`Already in records (${email || linkedinUrl}) — removed from view, nothing saved.`);
        removeFromView();
        return;
      }
      setApplyStatus((prev) => ({ ...prev, [itemId]: "done" }));
      notify(`Added to To Do: ${name || email || linkedinUrl}`, "success");
      removeFromView();
    } catch (err) {
      notify(`Error saving: ${(err as Error).message}`, "error");
      setApplyStatus((prev) => ({ ...prev, [itemId]: "error" }));
      setApplyErrors((prev) => ({ ...prev, [itemId]: (err as Error).message }));
    }
  }

  function handleViewClick(item: TodoItem, linkedinUrl: string) {
    setSelectedLinkedinUrl(linkedinUrl);
    setSelectedEmail(item.derived_email);
    setSelectedId(item.id);
  }

  function handleAddClick(item: TodoItem, linkedinUrl: string | null) {
    if (item.derived_email && linkedinUrl) {
      handleAddToTodo(item.id, linkedinUrl, item.derived_email, item.name, () =>
        deleteTodo(item.id)
      );
      return;
    }
    setAddPromptId(item.id);
    setEmailPromptValue(item.derived_email ?? "");
    setLinkedinPromptValue(linkedinUrl ?? "");
  }

  function submitAddPrompt(item: TodoItem) {
    const email = emailPromptValue.trim();
    const linkedinUrl = linkedinPromptValue.trim();
    if (!isValidEmail(email) || !linkedinUrl) return;
    setAddPromptId(null);
    handleAddToTodo(item.id, linkedinUrl, email, item.name, () => deleteTodo(item.id));
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault();
    setScanLoading(true);
    setScanError(null);
    setScanResult(null);
    try {
      const res = await fetch("/api/todo/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startId: Number(startId),
          endId: Number(endId),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setScanError(data.error ?? "scan failed");
      } else {
        setScanResult(data);
        await refresh(1);
      }
    } catch (err) {
      setScanError(`Could not reach the server (${(err as Error).message})`);
    } finally {
      setScanLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-zinc-50 font-sans dark:bg-black">
      <div className="flex flex-1 justify-center">
        <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6">
          <div>
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
              Braintrust
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Braintrust users not yet found in your records. View their
              LinkedIn profile and use Add to To Do to stage them for review
              on the To Do tab. Delete removes a candidate permanently.
            </p>
          </div>

          <form
            onSubmit={handleScan}
            className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
          >
            <div className="flex items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Start Braintrust ID
                <input
                  type="number"
                  value={startId}
                  onChange={(e) => setStartId(e.target.value)}
                  placeholder="e.g. 100"
                  disabled={scanLoading}
                  className="w-32 rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900 disabled:opacity-50"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                End Braintrust ID
                <input
                  type="number"
                  value={endId}
                  onChange={(e) => setEndId(e.target.value)}
                  placeholder="e.g. 200"
                  disabled={scanLoading}
                  className="w-32 rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900 disabled:opacity-50"
                />
              </label>
              <button
                type="submit"
                disabled={scanLoading || !startId || !endId}
                className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
              >
                {scanLoading && (
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/40 border-t-background"
                  />
                )}
                {scanLoading ? "Scanning..." : "Scan range"}
              </button>
            </div>
            <p className="text-xs text-zinc-500">
              Scans Engineering profiles with an external profile in that
              Braintrust ID range, checks them against your records (GitHub
              URL, LinkedIn URL, or a GitHub-derived email), and queues
              unmatched ones below. Any LinkedIn link found is also checked
              against the LinkedIn verify tool and shown as verified or not —
              an unverified link doesn&apos;t exclude the candidate, it&apos;s
              just a signal. Wider ranges take longer and use more GitHub API
              calls.
            </p>

            {scanLoading && (
              <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-black/[.02] px-3 py-2 text-sm text-zinc-600 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400">
                <span
                  aria-hidden
                  className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-400/40 border-t-zinc-500 dark:border-zinc-500/40 dark:border-t-zinc-300"
                />
                Working — scanning {startId}–{endId} and checking GitHub for
                missing emails. This can take a bit for larger ranges.
              </div>
            )}

            {scanError && (
              <p className="text-sm font-medium text-red-600 dark:text-red-400">
                Error: {scanError}
              </p>
            )}
            {scanResult && (
              <div>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Results for {startId}–{endId}
                </h2>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Stat
                    label="Matches condition"
                    value={scanResult.scanned.toLocaleString()}
                  />
                  <Stat
                    label="Already found"
                    value={scanResult.alreadyMatched.toLocaleString()}
                  />
                  <Stat
                    label="Newly queued"
                    value={scanResult.newlyQueued.toLocaleString()}
                  />
                  <Stat
                    label="Already queued"
                    value={scanResult.alreadyQueued.toLocaleString()}
                  />
                </div>
              </div>
            )}
          </form>

          {loading && <p className="text-sm text-zinc-500">Loading...</p>}

          {error && (
            <p className="text-sm font-medium text-red-600 dark:text-red-400">
              Error: {error}
            </p>
          )}

          {!loading && total === 0 && !error && (
            <p className="text-sm text-zinc-500">Nothing pending.</p>
          )}

          <div className="flex flex-col gap-3">
            {items.map((item) => {
              const linkedinUrl = resolveLinkedinUrl(item);
              const githubUrl = resolveGithubUrl(item);
              const rawAvatarUrl = githubAvatarUrl(githubUrl);
              const avatarUrl = brokenAvatarIds.has(item.id) ? null : rawAvatarUrl;
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 text-sm dark:border-white/10"
                >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarUrl ?? DEFAULT_AVATAR}
                      alt=""
                      width={36}
                      height={36}
                      className={`shrink-0 rounded-full bg-black/10 dark:bg-white/10 ${
                        avatarUrl ? "cursor-pointer" : ""
                      }`}
                      onClick={() =>
                        avatarUrl && setLightboxUrl(githubAvatarUrl(githubUrl, 460))
                      }
                      onError={() => {
                        setBrokenAvatarIds((prev) => {
                          if (prev.has(item.id)) return prev;
                          return new Set(prev).add(item.id);
                        });
                      }}
                    />
                    <div className="min-w-0 flex-1">
                    <div className="font-medium text-black dark:text-zinc-50">
                      {item.name || "—"}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                      <a
                        href={`https://app.usebraintrust.com/talent/${item.braintrust_id}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 underline dark:text-blue-400"
                      >
                        Braintrust
                      </a>
                      {item.external_profiles && item.external_profiles.length > 0 ? (
                        item.external_profiles.map((p, i) => (
                          <a
                            key={i}
                            href={p.public_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline dark:text-blue-400"
                          >
                            {p.site?.name ?? "Link"}
                            {p.site?.name === "LinkedIn" &&
                              item.linkedin_verified !== null &&
                              (item.linkedin_verified ? " ✓" : " (unverified)")}
                          </a>
                        ))
                      ) : (
                        <>
                          {item.github_url && (
                            <a
                              href={item.github_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline dark:text-blue-400"
                            >
                              GitHub
                            </a>
                          )}
                          {item.linkedin_url && (
                            <a
                              href={item.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 underline dark:text-blue-400"
                            >
                              LinkedIn
                              {item.linkedin_verified !== null &&
                                (item.linkedin_verified ? " ✓" : " (unverified)")}
                            </a>
                          )}
                        </>
                      )}
                      {item.derived_email && <span>{item.derived_email}</span>}
                    </div>
                    {applyStatus[item.id] === "error" && applyErrors[item.id] && (
                      <div className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                        {applyErrors[item.id]}
                      </div>
                    )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
                    {linkedinUrl && (
                      <button
                        onClick={() => handleViewClick(item, linkedinUrl)}
                        className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-white/15 dark:text-zinc-400"
                      >
                        View
                      </button>
                    )}
                    <button
                      onClick={() => handleAddClick(item, linkedinUrl)}
                      disabled={applyStatus[item.id] === "saving"}
                      className="whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                    >
                      {applyStatus[item.id] === "saving"
                        ? "Saving..."
                        : applyStatus[item.id] === "done"
                          ? "Added to To Do ✓"
                          : "Add to To Do"}
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      disabled={busyId === item.id}
                      className="whitespace-nowrap rounded-full border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 dark:border-red-900 dark:text-red-400 disabled:opacity-40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {addPromptId === item.id && (
                  <div className="flex flex-wrap items-end gap-3 border-t border-black/10 pt-3 dark:border-white/10">
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
                          if (e.key === "Enter") submitAddPrompt(item);
                          if (e.key === "Escape") setAddPromptId(null);
                        }}
                        placeholder="https://linkedin.com/in/..."
                        className="w-64 rounded border border-black/15 px-2 py-1.5 text-xs dark:border-white/15 dark:bg-zinc-900"
                      />
                    </label>
                    <button
                      onClick={() => submitAddPrompt(item)}
                      disabled={!isValidEmail(emailPromptValue.trim()) || !linkedinPromptValue.trim()}
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
                )}
                </div>
              );
            })}
          </div>

          {total > 0 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">
                Page {page} of {totalPages} ({total} pending)
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => refresh(page - 1)}
                  disabled={page <= 1 || loading}
                  className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium dark:border-white/15 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => refresh(page + 1)}
                  disabled={page >= totalPages || loading}
                  className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium dark:border-white/15 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
      {selectedLinkedinUrl && (
        <aside className="sticky top-0 h-screen w-1/2 shrink-0 overflow-y-auto border-l border-black/10 bg-white dark:border-white/10 dark:bg-zinc-950">
          <VeeProfilePanel
            profileUrl={selectedLinkedinUrl}
            email={selectedEmail}
            source="braintrust"
            onClose={() => {
              setSelectedLinkedinUrl(null);
              setSelectedEmail(null);
              setSelectedId(null);
            }}
            onAlreadyExists={() => {
              if (selectedId != null) deleteTodo(selectedId);
              setSelectedLinkedinUrl(null);
              setSelectedEmail(null);
              setSelectedId(null);
            }}
            onQueued={() => {
              if (selectedId != null) deleteTodo(selectedId);
            }}
          />
        </aside>
      )}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt=""
            className="max-h-full max-w-full rounded-lg shadow-2xl"
          />
        </div>
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
