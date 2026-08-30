"use client";

import { useState } from "react";
import Link from "next/link";

type Record = {
  id: number;
  name: string;
  email: string | null;
  link: string | null;
  other: string | null;
};

type Result =
  | { exists: true; record: Record }
  | { exists: false; record: Record }
  | { exists: false; record: null };

export default function Home() {
  const [email, setEmail] = useState("");
  const [link, setLink] = useState("");
  const [name, setName] = useState("");
  const [other, setOther] = useState("");
  const [onlySearch, setOnlySearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/check-or-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, link, name, other, onlySearch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "request failed");
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(`Could not reach the server (${(err as Error).message})`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col min-h-screen items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Search / Add User
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Enter an email and/or link. If a matching user already exists,
            you&apos;ll be notified. Otherwise, a new record is added.
          </p>
          <Link
            href="/upload"
            className="mt-2 inline-block text-sm text-blue-600 underline dark:text-blue-400"
          >
            Bulk upload from Excel →
          </Link>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
        >
          <label className="flex flex-col gap-1 text-sm">
            Email
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="someone@example.com"
              className="rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Link
            <input
              type="text"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://..."
              className="rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe (optional — falls back to email/link)"
              className="rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Other
            <input
              type="text"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="notes (optional)"
              className="rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={onlySearch}
              onChange={(e) => setOnlySearch(e.target.checked)}
            />
            Only search (don&apos;t add if not found)
          </label>
          <button
            type="submit"
            disabled={loading || (!email.trim() && !link.trim())}
            className="mt-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            {loading ? "Checking..." : onlySearch ? "Search" : "Check & Add"}
          </button>
        </form>

        {error && (
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            Error: {error}
          </p>
        )}

        {result && (
          <div
            className={`rounded-lg border p-4 text-sm ${
              result.exists
                ? "border-amber-400/50 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-950 dark:text-amber-200"
                : result.record
                ? "border-green-400/50 bg-green-50 text-green-900 dark:border-green-400/30 dark:bg-green-950 dark:text-green-200"
                : "border-zinc-400/50 bg-zinc-100 text-zinc-800 dark:border-zinc-400/30 dark:bg-zinc-800 dark:text-zinc-200"
            }`}
          >
            <p className="font-medium">
              {result.exists
                ? "This user already exists."
                : result.record
                ? "New user added."
                : "No matching user found."}
            </p>
            {result.record && (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="opacity-70">ID</dt>
                <dd>{result.record.id}</dd>
                <dt className="opacity-70">Name</dt>
                <dd>{result.record.name}</dd>
                <dt className="opacity-70">Email</dt>
                <dd>{result.record.email ?? "—"}</dd>
                <dt className="opacity-70">Link</dt>
                <dd>{result.record.link ?? "—"}</dd>
                <dt className="opacity-70">Other</dt>
                <dd>{result.record.other ?? "—"}</dd>
              </dl>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
