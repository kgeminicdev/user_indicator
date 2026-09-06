"use client";

import { useEffect, useState } from "react";
import type { VeeProfileData, VeeMonthYear } from "@/lib/veeProfileData";

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

export default function VeeProfilePanel({
  profileUrl,
  onClose,
  onLoaded,
}: {
  profileUrl: string;
  onClose?: () => void;
  onLoaded?: () => void;
}) {
  const [data, setData] = useState<VeeProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    fetch(`/api/vee-profile?url=${encodeURIComponent(profileUrl)}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `request failed (${res.status})`);
        return body as VeeProfileData;
      })
      .then(setData)
      .catch((err) => setError((err as Error).message))
      .finally(() => {
        setLoading(false);
        onLoaded?.();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileUrl]);

  const common = data?.common;
  const sortedSkills = common
    ? [...common.skills].sort((a, b) => b.endorsement_count - a.endorsement_count)
    : [];

  return (
    <div className="flex flex-col gap-4 p-4">
      {onClose && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            LinkedIn Profile
          </h2>
          <button
            onClick={onClose}
            className="rounded-full border border-black/15 px-3 py-1 text-xs font-medium dark:border-white/15"
          >
            Close
          </button>
        </div>
      )}

      {loading && <p className="text-sm text-zinc-500">Loading...</p>}

      {error && (
        <p className="text-sm font-medium text-red-600 dark:text-red-400">
          Error: {error}
        </p>
      )}

      {data && common && (
        <>
          <section className="flex flex-row gap-4 rounded-lg border border-black/10 p-4 dark:border-white/10">
            {common.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={common.image_url}
                alt=""
                width={140}
                height={140}
                className="h-[140px] w-[140px] shrink-0 rounded-full bg-black/10 object-cover dark:bg-white/10"
              />
            )}
            <div className="flex flex-1 flex-col gap-1">
              <h3 className="flex items-center gap-1.5 text-lg font-semibold text-black dark:text-zinc-50">
                {common.full_name}
                {common.is_verified && (
                  <span title="Verified" className="text-blue-500 dark:text-blue-400">
                    ✓
                  </span>
                )}
                {data.platform_fields.pronoun && (
                  <span className="text-sm font-normal text-zinc-500">
                    ({data.platform_fields.pronoun})
                  </span>
                )}
              </h3>
              {common.headline && (
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{common.headline}</p>
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
              <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                About
              </h3>
              <p className="whitespace-pre-line rounded-lg border border-black/10 p-3 text-sm text-zinc-700 dark:border-white/10 dark:text-zinc-300">
                {common.about}
              </p>
            </section>
          )}

          {common.experience.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Experience
              </h3>
              <div className="flex flex-col gap-3">
                {common.experience.map((exp, i) => (
                  <div key={i} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
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
              <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Education
              </h3>
              <div className="flex flex-col gap-3">
                {common.education.map((ed, i) => (
                  <div key={i} className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
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
              <h3 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Skills ({sortedSkills.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {sortedSkills.map((skill, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-black/15 px-3 py-1 text-xs text-zinc-700 dark:border-white/15 dark:text-zinc-300"
                  >
                    {skill.name}
                    {skill.endorsement_count > 0 && (
                      <span className="ml-1 text-zinc-400">{skill.endorsement_count}</span>
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
    </div>
  );
}
