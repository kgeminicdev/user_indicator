"use client";

import { Fragment, useEffect, useState } from "react";

type WorkingHistoryItem = {
  id: number;
  email: string | null;
  linkedin_url: string;
  content: string | null;
  source: string | null;
  created_at: string;
};

type WorkingHistoryPage = {
  items: WorkingHistoryItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

function loadWorkingHistory(page: number, from: string, to: string): Promise<WorkingHistoryPage> {
  const params = new URLSearchParams({ page: String(page) });
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return fetch(`/api/working-history?${params}`).then((res) => {
    if (!res.ok) throw new Error(`request failed (${res.status})`);
    return res.json();
  });
}

export default function WorkingHistoryPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<WorkingHistoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function refresh(page: number) {
    setLoading(true);
    setError(null);
    loadWorkingHistory(page, from, to)
      .then(setData)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  return (
    <div className="flex flex-col min-h-screen items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-4xl flex-col gap-8 py-16 px-6">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Working History
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Candidates logged via &quot;Copy and Applied&quot; on their LinkedIn profile.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <label className="flex flex-col gap-1 text-sm">
            From
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            To
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </label>
          {(from || to) && (
            <button
              onClick={() => {
                setFrom("");
                setTo("");
              }}
              className="rounded-full border border-black/15 px-4 py-2 text-xs font-medium dark:border-white/15"
            >
              Clear
            </button>
          )}
        </div>

        {data && (
          <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
            <div className="text-3xl font-semibold text-black dark:text-zinc-50">
              {data.total.toLocaleString()}
            </div>
            <div className="text-xs text-zinc-500">
              {from || to ? "users done in the selected range" : "users done total"}
            </div>
          </div>
        )}

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
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Email</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">LinkedIn</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Source</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Created</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Content</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <Fragment key={item.id}>
                      <tr className="border-b border-black/5 last:border-0 dark:border-white/5">
                        <td className="px-3 py-2">{item.email ?? "no email"}</td>
                        <td className="px-3 py-2">
                          <a
                            href={item.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline dark:text-blue-400"
                          >
                            LinkedIn
                          </a>
                        </td>
                        <td className="px-3 py-2 capitalize text-zinc-600 dark:text-zinc-400">
                          {item.source ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-zinc-500">
                          {new Date(item.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2">
                          {item.content ? (
                            <button
                              onClick={() =>
                                setExpandedId(expandedId === item.id ? null : item.id)
                              }
                              className="text-xs text-zinc-500 underline"
                            >
                              {expandedId === item.id ? "Hide" : "Show"}
                            </button>
                          ) : (
                            <span className="text-xs text-zinc-400">—</span>
                          )}
                        </td>
                      </tr>
                      {expandedId === item.id && item.content && (
                        <tr className="border-b border-black/5 dark:border-white/5">
                          <td colSpan={5} className="px-3 py-2">
                            <p className="whitespace-pre-line rounded-lg border border-black/10 p-3 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400">
                              {item.content}
                            </p>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              {data.items.length === 0 && (
                <p className="p-4 text-sm text-zinc-500">Nothing logged yet.</p>
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
