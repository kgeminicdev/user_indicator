"use client";

import { useState } from "react";

type VerifyResult = {
  valid: boolean;
  name: string | null;
};

export default function LinkedinVerifyPage() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/linkedin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col min-h-screen items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            LinkedIn Verify
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Checks a LinkedIn profile URL against the verify tool and shows
            whether it counts as valid (a non-empty, non-placeholder name
            came back).
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
        >
          <label className="flex flex-col gap-1 text-sm">
            LinkedIn URL
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/some-slug"
              disabled={loading}
              className="w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900 disabled:opacity-50"
            />
          </label>
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="flex w-fit items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            {loading && (
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/40 border-t-background"
              />
            )}
            {loading ? "Checking..." : "Check"}
          </button>
        </form>

        {error && (
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            Error: {error}
          </p>
        )}

        {result && (
          <div className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/10">
            <p className="font-medium text-black dark:text-zinc-50">
              {result.valid ? "Valid ✓" : "Invalid ✗"}
            </p>
            <p className="mt-1 text-zinc-600 dark:text-zinc-400">
              name: {result.name ? `"${result.name}"` : "(empty)"}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
