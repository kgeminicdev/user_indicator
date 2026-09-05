"use client";

import { useEffect, useState } from "react";
import type { VeeProfileData, VeeMonthYear, VeeUsage } from "@/lib/veeProfileData";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatMonthYear(d: VeeMonthYear | null | undefined): string {
  if (!d || !d.year) return "Present";
  return d.month ? `${MONTHS[d.month - 1]} ${d.year}` : `${d.year}`;
}

function formatDateRange(
  start: VeeMonthYear,
  end: VeeMonthYear,
  isCurrent: boolean
): string {
  return `${formatMonthYear(start)} – ${isCurrent ? "Present" : formatMonthYear(end)}`;
}

function loadUsage(): Promise<VeeUsage> {
  return fetch("/api/vee-profile/usage").then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
    return body as VeeUsage;
  });
}

export default function VeeProfilePage() {
  const [profileUrl, setProfileUrl] = useState("");
  const [data, setData] = useState<VeeProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [usage, setUsage] = useState<VeeUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  useEffect(() => {
    loadUsage()
      .then(setUsage)
      .catch((err) => setUsageError((err as Error).message));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/vee-profile?url=${encodeURIComponent(profileUrl)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
      setData(body as VeeProfileData);
      loadUsage()
        .then(setUsage)
        .catch((err) => setUsageError((err as Error).message));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const common = data?.common;
  console.log(common)
  const sortedSkills = common
    ? [...common.skills].sort((a, b) => b.endorsement_count - a.endorsement_count)
    : [];

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
              disabled={loading}
              className="w-full rounded border border-black/15 px-3 py-2 text-sm dark:border-white/15 dark:bg-zinc-900 disabled:opacity-50"
            />
          </label>
          <button
            type="submit"
            disabled={loading || !profileUrl.trim()}
            className="flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
          >
            {loading && (
              <span
                aria-hidden
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-background/40 border-t-background"
              />
            )}
            {loading ? "Loading..." : "Load"}
          </button>
        </form>

        {error && (
          <p className="text-sm font-medium text-red-600 dark:text-red-400">
            Error: {error}
          </p>
        )}

        {data && common && (
          <>
            <section className="flex flex-col gap-4 rounded-lg border border-black/10 p-5 dark:border-white/10 sm:flex-row sm:items-start">
              {common.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={common.image_url}
                  alt=""
                  width={88}
                  height={88}
                  className="h-22 w-22 shrink-0 rounded-full bg-black/10 object-cover dark:bg-white/10"
                />
              )}
              <div className="flex flex-1 flex-col gap-1">
                <h2 className="flex items-center gap-1.5 text-xl font-semibold text-black dark:text-zinc-50">
                  {common.full_name}
                  {common.is_verified && (
                    <span
                      title="Verified"
                      className="text-blue-500 dark:text-blue-400"
                    >
                      ✓
                    </span>
                  )}
                  {data.platform_fields.pronoun && (
                    <span className="text-sm font-normal text-zinc-500">
                      ({data.platform_fields.pronoun})
                    </span>
                  )}
                </h2>
                {common.headline && (
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {common.headline}
                  </p>
                )}
                {common.current_position?.company_name && (
                  <p className="text-sm text-zinc-500">
                    {common.current_position.company_url ? (
                      <a
                        href={common.current_position.company_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {common.current_position.company_name}
                      </a>
                    ) : (
                      common.current_position.company_name
                    )}
                  </p>
                )}
                {common.location?.name && (
                  <p className="text-sm text-zinc-500">{common.location.name}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                  {common.connections != null && (
                    <span>{common.connections.toLocaleString()} connections</span>
                  )}
                  {common.followers != null && (
                    <span>{common.followers.toLocaleString()} followers</span>
                  )}
                  {data.platform_fields.is_hiring && <span>Hiring</span>}
                  <a
                    href={common.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 underline dark:text-blue-400"
                  >
                    LinkedIn
                  </a>
                </div>
              </div>
            </section>

            {common.about && (
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  About
                </h2>
                <p className="whitespace-pre-line rounded-lg border border-black/10 p-4 text-sm text-zinc-700 dark:border-white/10 dark:text-zinc-300">
                  {common.about}
                </p>
              </section>
            )}

            {common.experience.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Experience
                </h2>
                <div className="flex flex-col gap-3">
                  {common.experience.map((exp, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-black/10 p-4 dark:border-white/10"
                    >
                      <div className="text-sm font-medium text-black dark:text-zinc-50">
                        {exp.company.url ? (
                          <a
                            href={exp.company.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            {exp.company.name}
                          </a>
                        ) : (
                          exp.company.name
                        )}
                      </div>
                      <div className="mt-1 flex flex-col gap-1.5">
                        {exp.positions.map((pos, j) => (
                          <div key={j}>
                            <div className="text-sm text-zinc-700 dark:text-zinc-300">
                              {pos.role}
                            </div>
                            <div className="text-xs text-zinc-500">
                              {formatDateRange(pos.start_date, pos.end_date, pos.is_current)}
                              {pos.location && ` · ${pos.location}`}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {common.education.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Education
                </h2>
                <div className="flex flex-col gap-3">
                  {common.education.map((ed, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/10"
                    >
                      <div className="font-medium text-black dark:text-zinc-50">
                        {ed.institution_url ? (
                          <a
                            href={ed.institution_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            {ed.institution}
                          </a>
                        ) : (
                          ed.institution
                        )}
                      </div>
                      {ed.degree && (
                        <div className="text-zinc-600 dark:text-zinc-400">{ed.degree}</div>
                      )}
                      {(ed.start_year || ed.end_year) && (
                        <div className="text-xs text-zinc-500">
                          {ed.start_year ?? "?"} – {ed.end_year ?? "?"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {sortedSkills.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Skills ({sortedSkills.length})
                </h2>
                <div className="flex flex-wrap gap-2">
                  {sortedSkills.map((skill, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-black/15 px-3 py-1 text-xs text-zinc-700 dark:border-white/15 dark:text-zinc-300"
                    >
                      {skill.name}
                      {skill.endorsement_count > 0 && (
                        <span className="ml-1 text-zinc-400">
                          {skill.endorsement_count}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {data.data_as_of && (
              <p className="text-xs text-zinc-400">
                Data as of {new Date(data.data_as_of).toLocaleString()}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
