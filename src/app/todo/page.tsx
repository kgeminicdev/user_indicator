"use client";

import { useEffect, useState } from "react";
import VeeProfilePanel from "@/components/VeeProfilePanel";
import type { VeeProfileData } from "@/lib/veeProfileData";
import { buildVeeApplyContent } from "@/lib/veeProfileFormat";

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

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export default function TodoPage() {
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
  const [applyStatus, setApplyStatus] = useState<Record<string, "saving" | "done" | "error">>({});
  const [applyErrors, setApplyErrors] = useState<Record<string, string>>({});

  // Braintrust candidates often have no derived email — Copy and Applied
  // requires one to be typed in first rather than proceeding with a null
  // email; View works fine without one.
  const [emailPrompt, setEmailPrompt] = useState<{ id: number; linkedinUrl: string } | null>(
    null
  );
  const [emailPromptValue, setEmailPromptValue] = useState("");

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

      const saveRes = await fetch("/api/working-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          linkedinUrl,
          content,
          source: "braintrust",
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

  function handleViewClick(item: TodoItem, linkedinUrl: string) {
    setSelectedLinkedinUrl(linkedinUrl);
    setSelectedEmail(item.derived_email);
    setSelectedId(item.id);
  }

  function handleApplyClick(item: TodoItem, linkedinUrl: string) {
    if (!item.derived_email) {
      setEmailPrompt({ id: item.id, linkedinUrl });
      setEmailPromptValue("");
      return;
    }
    handleCopyAndApplied(linkedinUrl, item.derived_email, () => deleteTodo(item.id));
  }

  function submitEmailPrompt() {
    const email = emailPromptValue.trim();
    if (!emailPrompt || !isValidEmail(email)) return;
    const { id, linkedinUrl } = emailPrompt;
    setEmailPrompt(null);
    handleCopyAndApplied(linkedinUrl, email, () => deleteTodo(id));
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
              To Do
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Braintrust users not yet found in your records. View their
              LinkedIn profile and use Copy and Applied to log outreach and
              save them to your records. Delete removes a candidate
              permanently.
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
              return (
                <div
                  key={item.id}
                  className="flex flex-col gap-2 rounded-lg border border-black/10 p-4 text-sm dark:border-white/10 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
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
                    {linkedinUrl &&
                      applyStatus[linkedinUrl] === "error" &&
                      applyErrors[linkedinUrl] && (
                        <div className="mt-1 text-[11px] font-medium text-red-600 dark:text-red-400">
                          {applyErrors[linkedinUrl]}
                        </div>
                      )}
                  </div>
                  {emailPrompt?.id === item.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="email"
                        autoFocus
                        value={emailPromptValue}
                        onChange={(e) => setEmailPromptValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitEmailPrompt();
                          if (e.key === "Escape") setEmailPrompt(null);
                        }}
                        placeholder="Email required"
                        className="w-48 rounded border border-black/15 px-2 py-1.5 text-xs dark:border-white/15 dark:bg-zinc-900"
                      />
                      <button
                        onClick={submitEmailPrompt}
                        disabled={!isValidEmail(emailPromptValue.trim())}
                        className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                      >
                        Continue
                      </button>
                      <button
                        onClick={() => setEmailPrompt(null)}
                        className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium dark:border-white/15"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {linkedinUrl && (
                        <>
                          <button
                            onClick={() => handleViewClick(item, linkedinUrl)}
                            className="rounded-full border border-black/15 px-3 py-1.5 text-xs font-medium text-zinc-600 dark:border-white/15 dark:text-zinc-400"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleApplyClick(item, linkedinUrl)}
                            disabled={applyStatus[linkedinUrl] === "saving"}
                            className="rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                          >
                            {applyStatus[linkedinUrl] === "saving"
                              ? "Saving..."
                              : applyStatus[linkedinUrl] === "done"
                                ? "Copied & Saved ✓"
                                : "Copy and Applied"}
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleDelete(item)}
                        disabled={busyId === item.id}
                        className="rounded-full border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 dark:border-red-900 dark:text-red-400 disabled:opacity-40"
                      >
                        Delete
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
