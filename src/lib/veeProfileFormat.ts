// Client-safe formatting helpers for VeeProfileData — only imports types
// from veeProfileData.ts (erased at compile time), never its runtime code,
// which depends on undici/env vars and must stay server-only.
import type { VeeProfileData, VeeMonthYear } from "./veeProfileData";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatMonthYear(d: VeeMonthYear | null | undefined): string {
  if (!d || !d.year) return "Present";
  return d.month ? `${MONTHS[d.month - 1]} ${d.year}` : `${d.year}`;
}

export function formatDateRange(
  start: VeeMonthYear,
  end: VeeMonthYear,
  isCurrent: boolean
): string {
  return `${formatMonthYear(start)} – ${isCurrent ? "Present" : formatMonthYear(end)}`;
}

export function buildVeeApplyContent(data: VeeProfileData): string {
  const common = data.common;
  const lines: string[] = [common.full_name];
  if (common.headline) lines.push(common.headline);
  lines.push("");
  if (common.about) {
    lines.push("About:");
    lines.push(common.about);
    lines.push("");
  }
  if (common.experience.length > 0) {
    lines.push("Experience:");
    for (const exp of common.experience) {
      for (const pos of exp.positions) {
        lines.push(
          `- ${pos.role} at ${exp.company.name} (${formatDateRange(pos.start_date, pos.end_date, pos.is_current)})`
        );
      }
    }
  }
  return lines.join("\n");
}
