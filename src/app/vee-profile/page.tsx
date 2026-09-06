"use client";

import { useEffect, useState } from "react";
import type { VeeUsage } from "@/lib/veeProfileData";
import VeeProfilePanel from "@/components/VeeProfilePanel";

function loadUsage(): Promise<VeeUsage> {
  return fetch("/api/vee-profile/usage").then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
    return body as VeeUsage;
  });
}

export default function VeeProfilePage() {
  const [profileUrl, setProfileUrl] = useState("");
  const [submittedUrl, setSubmittedUrl] = useState<string | null>(null);

  const [usage, setUsage] = useState<VeeUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  useEffect(() => {
    loadUsage()
      .then(setUsage)
      .catch((err) => setUsageError((err as Error).message));
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmittedUrl(profileUrl);
  }

  function refreshUsage() {
    loadUsage()
      .then(setUsage)
      .catch((err) => setUsageError((err as Error).message));
  }

  return (
    <div className="flex flex-col min-h-screen items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Vee Profile Viewer
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Look up any LinkedIn profile through the local Vee lookup service.
          </p>
        </div>

        {usage && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-black/10 bg-black/[.02] px-4 py-2.5 text-xs text-zinc-600 dark:border-white/10 dark:bg-white/[.03] dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {usage.plan ?? "unknown"} plan
            </span>
            {usage.currentProxyIp && (
              <span>
                IP {usage.currentProxyIp}
                {usage.proxyIpCount > 0 && ` (${usage.proxyIpCount} in rotation)`}
              </span>
            )}
            {usage.freeTier && (
              <span>
                {usage.freeTier.usedToday ?? "?"} / {usage.freeTier.creditsPerIpDay ?? "?"}{" "}
                credits used today ({usage.freeTier.remainingToday ?? "?"} left
                {usage.freeTier.resets &&
                  `, resets ${new Date(usage.freeTier.resets).toLocaleString()}`}
                )
              </span>
            )}
            {usage.realtimeOpsLimit != null && (
              <span>
                {usage.realtimeOpsUsed ?? 0}/{usage.realtimeOpsLimit} realtime ops
              </span>
            )}
            {usage.concurrentLimit != null && (
              <span>concurrency {usage.concurrentLimit}</span>
            )}
          </div>
        )}
        {usageError && (
          <p className="text-xs text-zinc-400">Usage unavailable: {usageError}</p>
        )}

        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
        >
          <label className="flex flex-1 flex-col gap-1 text-sm">
            LinkedIn URL
            <input
              type="text"
              value={profileUrl}
              onChange={(e) => setProfileUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/some-slug"
              className="w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900 disabled:opacity-50"
            />
          </label>
          <button
            type="submit"
            disabled={!profileUrl.trim()}
            className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            Load
          </button>
        </form>

        {submittedUrl && (
          <VeeProfilePanel profileUrl={submittedUrl} onLoaded={refreshUsage} />
        )}
      </main>
    </div>
  );
}
