"use client";

import { useState } from "react";
import Link from "next/link";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [statusIsError, setStatusIsError] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setStatus(null);
    setStatusIsError(false);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) {
        setStatusIsError(true);
        setStatus(`Error: ${data.error ?? "upload failed"}`);
      } else {
        setStatus(`Inserted ${data.inserted} of ${data.totalRows} rows.`);
        setFile(null);
      }
    } catch (err) {
      setStatusIsError(true);
      setStatus(
        `Error: could not reach the server (${(err as Error).message}). Is the dev server still running?`
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col min-h-screen items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Excel to Postgres Sync
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Upload an .xlsx/.csv file with columns: name, email, link, other.
          </p>
          <Link
            href="/"
            className="mt-2 inline-block text-sm text-blue-600 underline dark:text-blue-400"
          >
            ← Back to search / add
          </Link>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
          <button
            onClick={handleUpload}
            disabled={!file || loading}
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            {loading ? "Uploading..." : "Upload"}
          </button>
        </div>

        {status && (
          <p
            className={`text-sm font-medium ${
              statusIsError
                ? "text-red-600 dark:text-red-400"
                : "text-green-700 dark:text-green-400"
            }`}
          >
            {status}
          </p>
        )}
      </main>
    </div>
  );
}
