"use client";

import { Fragment, useEffect, useState } from "react";
import { notify } from "@/components/Toast";

type TodoEntry = {
  id: number;
  name: string | null;
  email: string | null;
  link: string;
  content: string | null;
  source: string | null;
  created_at: string;
};

type TodoEntriesPage = {
  items: TodoEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function loadEntries(page: number): Promise<TodoEntriesPage> {
  return fetch(`/api/todo-entries?page=${page}`).then((res) => {
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    return res.json();
  });
}

export default function TodoPage() {
  const [data, setData] = useState<TodoEntriesPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [fetchingId, setFetchingId] = useState<number | null>(null);

  function refresh(page: number) {
    setLoading(true);
    setError(null);
    return loadEntries(page)
      .then(setData)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh(1);
  }, []);

  async function handleApplied(entry: TodoEntry) {
    setBusyId(entry.id);
    try {
      const clipboardText = [entry.email ? `Email: ${entry.email}` : null, entry.content]
        .filter(Boolean)
        .join("\n\n");
      if (clipboardText) {
        try {
          await navigator.clipboard.writeText(clipboardText);
        } catch {
          // Clipboard access can fail (permissions, insecure context) —
          // still finalize the apply either way.
        }
      }
      const res = await fetch(`/api/todo-entries/${entry.id}/apply`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
      notify(`Applied: ${entry.name || entry.email || entry.link}`, "success");
      const nextPage = data && data.items.length === 1 && data.page > 1 ? data.page - 1 : data?.page ?? 1;
      await refresh(nextPage);
    } catch (err) {
      notify(`Error applying: ${(err as Error).message}`, "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleGetContent(entry: TodoEntry) {
    setFetchingId(entry.id);
    try {
      const res = await fetch("/api/todo-entries/fetch-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
      if (body.updated > 0) {
        notify(`Content fetched: ${entry.name || entry.email || entry.link}`, "success");
      } else if (body.failed > 0) {
        throw new Error(body.failures[0] || "Failed to fetch content");
      } else {
        notify(`Nothing to fetch: ${entry.name || entry.email || entry.link}`);
      }
      await refresh(data?.page ?? 1);
    } catch (err) {
      notify(`Error fetching content: ${(err as Error).message}`, "error");
    } finally {
      setFetchingId(null);
    }
  }

  async function handleRemove(entry: TodoEntry) {
    const ok = window.confirm(
      `Remove ${entry.name || entry.email || entry.link} from To Do? This cannot be undone.`
    );
    if (!ok) return;

    setBusyId(entry.id);
    try {
      const res = await fetch(`/api/todo-entries/${entry.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`request failed (${res.status})`);
      notify(`Removed: ${entry.name || entry.email || entry.link}`);
      const nextPage = data && data.items.length === 1 && data.page > 1 ? data.page - 1 : data?.page ?? 1;
      await refresh(nextPage);
    } catch (err) {
      notify(`Error removing: ${(err as Error).message}`, "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col min-h-screen items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-4xl flex-col gap-8 py-16 px-6">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            To Do
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Candidates staged from GitHub, Braintrust, and HackerRank. Content is fetched from
            LinkedIn in the background — use &quot;Get content&quot; to fetch it now instead of
            waiting. Copy and Applied copies the email and content to your clipboard and moves
            them to records and working history; Remove discards them.
          </p>
        </div>

        {loading && <p className="text-sm text-zinc-500">Loading...</p>}
        {error && (
          <p className="text-sm font-medium text-red-600 dark:text-red-400">Error: {error}</p>
        )}

        {data && (
          <>
            <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-black/10 bg-black/[.02] text-xs text-zinc-500 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400">
                  <tr>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Name</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Email</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Link</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Source</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Content</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((entry) => (
                    <Fragment key={entry.id}>
                      <tr className="border-b border-black/5 last:border-0 dark:border-white/5">
                        <td className="px-3 py-2">{entry.name ?? "—"}</td>
                        <td className="px-3 py-2">{entry.email ?? "—"}</td>
                        <td className="px-3 py-2">
                          <a
                            href={entry.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline dark:text-blue-400"
                          >
                            Link
                          </a>
                        </td>
                        <td className="px-3 py-2 capitalize text-zinc-600 dark:text-zinc-400">
                          {entry.source ?? "—"}
                        </td>
                        <td className="px-3 py-2">
                          {entry.content ? (
                            <button
                              onClick={() =>
                                setExpandedId(expandedId === entry.id ? null : entry.id)
                              }
                              className="text-xs text-zinc-500 underline"
                            >
                              {expandedId === entry.id ? "Hide" : "Show"}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleGetContent(entry)}
                              disabled={fetchingId === entry.id}
                              className="whitespace-nowrap rounded-full border border-black/15 px-2.5 py-1 text-xs font-medium text-zinc-600 disabled:opacity-40 dark:border-white/15 dark:text-zinc-400"
                            >
                              {fetchingId === entry.id ? "Fetching..." : "Get content"}
                            </button>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex shrink-0 flex-nowrap items-center gap-2">
                            <button
                              onClick={() => handleApplied(entry)}
                              disabled={busyId === entry.id}
                              className="whitespace-nowrap rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background disabled:opacity-40"
                            >
                              Copy and Applied
                            </button>
                            <button
                              onClick={() => handleRemove(entry)}
                              disabled={busyId === entry.id}
                              className="whitespace-nowrap rounded-full border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 dark:border-red-900 dark:text-red-400 disabled:opacity-40"
                            >
                              Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedId === entry.id && entry.content && (
                        <tr className="border-b border-black/5 dark:border-white/5">
                          <td colSpan={6} className="px-3 py-2">
                            <p className="whitespace-pre-line rounded-lg border border-black/10 p-3 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400">
                              {entry.content}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {data.items.length === 0 && (
                <p className="p-4 text-sm text-zinc-500">Nothing to do.</p>
              )}
            </div>

            {data.total > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">
                  Page {data.page} of {data.totalPages} ({data.total.toLocaleString()} total)
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => refresh(data.page - 1)}
                    disabled={data.page <= 1 || loading}
                    className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium dark:border-white/15 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => refresh(data.page + 1)}
                    disabled={data.page >= data.totalPages || loading}
                    className="rounded-full border border-black/15 px-4 py-1.5 text-xs font-medium dark:border-white/15 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
