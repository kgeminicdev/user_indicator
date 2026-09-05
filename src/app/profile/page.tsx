"use client";

import { useState } from "react";
import type { ProfileData } from "@/lib/profileData";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Present";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatRange(start: string | null, end: string | null): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}

export default function ProfilePage() {
  const [profileUrl, setProfileUrl] = useState("");
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/profile?url=${encodeURIComponent(profileUrl)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
      setData(body as ProfileData);
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
            Profile
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Look up a LinkedIn profile through the local profile lookup service.
          </p>
        </div>

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

        {data && (
          <>
            <section className="flex flex-col gap-4 rounded-lg border border-black/10 p-5 dark:border-white/10 sm:flex-row sm:items-start">
              {data.summary.profileImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.summary.profileImage}
                  alt=""
                  width={88}
                  height={88}
                  className="h-22 w-22 shrink-0 rounded-full bg-black/10 object-cover dark:bg-white/10"
                />
              )}
              <div className="flex flex-1 flex-col gap-1">
                <h2 className="text-xl font-semibold text-black dark:text-zinc-50">
                  {data.summary.fullName}
                </h2>
                {data.headline && (
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">
                    {data.headline}
                  </p>
                )}
                <p className="text-sm text-zinc-500">
                  {data.summary.jobTitle}
                  {data.summary.currentCompanies.length > 0 &&
                    ` · ${data.summary.currentCompanies.join(", ")}`}
                </p>
                {data.summary.location && (
                  <p className="text-sm text-zinc-500">{data.summary.location}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
                  {data.socialPresence?.connections?.total != null && (
                    <span>
                      {data.socialPresence.connections.total.toLocaleString()} connections
                    </span>
                  )}
                  {data.socialPresence?.followers?.total != null && (
                    <span>
                      {data.socialPresence.followers.total.toLocaleString()} followers
                    </span>
                  )}
                  {data.slug.linkedin && (
                    <a
                      href={`https://www.linkedin.com/in/${data.slug.linkedin}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 underline dark:text-blue-400"
                    >
                      LinkedIn
                    </a>
                  )}
                </div>
              </div>
            </section>

            {data.about && (
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  About
                </h2>
                <p className="whitespace-pre-line rounded-lg border border-black/10 p-4 text-sm text-zinc-700 dark:border-white/10 dark:text-zinc-300">
                  {data.about}
                </p>
              </section>
            )}

            {data.experience.work.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Experience
                </h2>
                <div className="flex flex-col gap-3">
                  {data.experience.work.map((job, i) => (
                    <div
                      key={i}
                      className="flex gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"
                    >
                      {job.companyInfo?.linkedin?.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={job.companyInfo.linkedin.logoUrl}
                          alt=""
                          width={40}
                          height={40}
                          className="h-10 w-10 shrink-0 rounded bg-black/10 object-cover dark:bg-white/10"
                        />
                      ) : (
                        <div className="h-10 w-10 shrink-0 rounded bg-black/10 dark:bg-white/10" />
                      )}
                      <div className="flex flex-col gap-0.5">
                        <div className="text-sm font-medium text-black dark:text-zinc-50">
                          {job.title}
                        </div>
                        <div className="text-sm text-zinc-600 dark:text-zinc-400">
                          {job.companyInfo?.linkedin?.website ? (
                            <a
                              href={job.companyInfo.linkedin.website}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline"
                            >
                              {job.companyName}
                            </a>
                          ) : (
                            job.companyName
                          )}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {formatRange(job.startDate, job.endDate)}
                          {job.location && ` · ${job.location}`}
                        </div>
                        {job.description && (
                          <p className="mt-1 whitespace-pre-line text-xs text-zinc-600 dark:text-zinc-400">
                            {job.description}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data.education.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Education
                </h2>
                <div className="flex flex-col gap-3">
                  {data.education.map((ed, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-black/10 p-4 text-sm dark:border-white/10"
                    >
                      <div className="font-medium text-black dark:text-zinc-50">
                        {ed.school}
                      </div>
                      <div className="text-zinc-600 dark:text-zinc-400">
                        {[ed.degreeName, ed.fieldOfStudy].filter(Boolean).join(", ")}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {formatRange(ed.startDate, ed.endDate)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data.certifications.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Certifications
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {data.certifications.map((cert, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10"
                    >
                      {cert.url ? (
                        <a
                          href={cert.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-black underline dark:text-zinc-50"
                        >
                          {cert.name}
                        </a>
                      ) : (
                        <div className="font-medium text-black dark:text-zinc-50">
                          {cert.name}
                        </div>
                      )}
                      <div className="text-xs text-zinc-500">
                        {cert.authority}
                        {cert.startDate && ` · ${formatDate(cert.startDate)}`}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data.languages.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Languages
                </h2>
                <div className="flex flex-wrap gap-2">
                  {data.languages.map((lang, i) => (
                    <span
                      key={i}
                      className="rounded-full border border-black/15 px-3 py-1 text-xs text-zinc-700 dark:border-white/15 dark:text-zinc-300"
                    >
                      {lang.name}
                      <span className="ml-1 text-zinc-400">
                        ({lang.proficiency.replaceAll("_", " ").toLowerCase()})
                      </span>
                    </span>
                  ))}
                </div>
              </section>
            )}

            {data.activities.length > 0 && (
              <section>
                <h2 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Recent Activity
                </h2>
                <div className="flex flex-col gap-2">
                  {data.activities.map((act, i) => (
                    <a
                      key={i}
                      href={act.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-black/10 p-3 text-sm text-zinc-700 hover:bg-black/[.02] dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/[.03]"
                    >
                      {act.title}
                    </a>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
