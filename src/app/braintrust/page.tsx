"use client";

import { useEffect, useState } from "react";

type SyncStatus = {
  rangeStart: number;
  rangeEnd: number;
  lastId: number;
  syncedUs: number;
  skippedNonUs: number;
  notFound: number;
  failed: number;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
};

type ExternalProfile = {
  site: { name: string };
  public_url: string;
};

type FreelancerSample = {
  id: number;
  publicName: string | null;
  syncedAt: string;
  basicStack: string | null;
  experienceYears: string | null;
  skillCount: number;
  externalProfiles: ExternalProfile[];
};

type PlatformCounts = {
  linkedin: number;
  github: number;
  personalWebsite: number;
};

type BraintrustData = {
  total: number;
  filteredTotal: number;
  platformCounts: PlatformCounts;
  syncStatus: SyncStatus | null;
  sample: FreelancerSample[];
};

export default function BraintrustPage() {
  const [data, setData] = useState<BraintrustData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/braintrust")
      .then((res) => {
        if (!res.ok) throw new Error(`request failed (${res.status})`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const progressPct =
    data?.syncStatus && data.syncStatus.rangeEnd > data.syncStatus.rangeStart
      ? Math.min(
          100,
          ((data.syncStatus.lastId - data.syncStatus.rangeStart) /
            (data.syncStatus.rangeEnd - data.syncStatus.rangeStart)) *
            100
        )
      : null;

  return (
    <div className="flex flex-col min-h-screen items-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-3xl flex-col gap-8 py-16 px-6">
        <div>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Braintrust
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            A snapshot of the synced Braintrust freelancer data, filtered to
            Engineering profiles with at least one external profile link.
          </p>
        </div>

        {loading && (
          <p className="text-sm text-zinc-500">Loading...</p>
        )}

        {error && (
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            Error: {error}
          </p>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Total freelancers" value={data.total.toLocaleString()} />
              <Stat
                label="Engineering + external profile"
                value={data.filteredTotal.toLocaleString()}
              />
              {data.syncStatus && (
                <>
                  <Stat
                    label="Synced (US)"
                    value={data.syncStatus.syncedUs.toLocaleString()}
                  />
                  <Stat
                    label="Failed"
                    value={data.syncStatus.failed.toLocaleString()}
                  />
                </>
              )}
            </div>

            {progressPct !== null && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-zinc-500">
                  <span>Sync progress</span>
                  <span>{progressPct.toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                  <div
                    className="h-full bg-foreground"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            <div>
              <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Platform breakdown (Engineering + external profile)
              </h2>
              <div className="grid grid-cols-3 gap-4">
                <Stat
                  label="LinkedIn"
                  value={data.platformCounts.linkedin.toLocaleString()}
                />
                <Stat
                  label="GitHub"
                  value={data.platformCounts.github.toLocaleString()}
                />
                <Stat
                  label="Personal Website"
                  value={data.platformCounts.personalWebsite.toLocaleString()}
                />
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Engineering, with external profiles (most recently synced)
              </h2>
              <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
                <table className="w-full text-sm">
                  <thead className="bg-black/5 dark:bg-white/5">
                    <tr>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Basic Stack</th>
                      <th className="px-3 py-2 text-left">Experience Years</th>
                      <th className="px-3 py-2 text-left">Skill</th>
                      <th className="px-3 py-2 text-left">External profiles</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sample.map((f) => (
                      <tr
                        key={f.id}
                        className="border-t border-black/10 dark:border-white/10"
                      >
                        <td className="px-3 py-2">{f.publicName || "—"}</td>
                        <td className="px-3 py-2">{f.basicStack || "—"}</td>
                        <td className="px-3 py-2">{f.experienceYears ?? "—"}</td>
                        <td className="px-3 py-2">{f.skillCount}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            {f.externalProfiles.map((p, i) => (
                              <a
                                key={i}
                                href={p.public_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 underline dark:text-blue-400"
                              >
                                {p.site?.name ?? "link"}
                              </a>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {data.sample.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                          No matching data.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
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
