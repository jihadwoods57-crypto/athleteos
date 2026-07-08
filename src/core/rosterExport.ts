// OnStandard — roster export (add-on build 2026-07-04; pure TS, no RN imports).
//
// The coach's reporting add-on: a spreadsheet-ready CSV of the roster a coach can drop in
// front of an AD, a parent meeting, or their own program review. Real numbers only — it
// serializes exactly the rows the dashboard shows (the one platform-owned score), so the
// exported report can never disagree with the app.
import { gradeFor } from './scoring';

export interface RosterExportRow {
  name: string;
  pos: string;
  score: number;
  comp: number;
  loggedToday?: boolean;
}

/** Escape one CSV field (quotes, commas, newlines — coach/athlete names are free text). */
function csvField(v: string | number | boolean): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The roster as CSV, header row first, athletes in the given (risk-ranked) order. */
export function rosterCsv(rows: RosterExportRow[]): string {
  const header = ['Athlete', 'Position', 'Score', 'Grade', 'Compliance %', 'Logged today'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      csvField(r.name),
      csvField(r.pos ?? ''),
      csvField(r.score),
      csvField(gradeFor(r.score).g),
      csvField(r.comp),
      csvField(r.loggedToday === false ? 'no' : 'yes'),
    ].join(','));
  }
  return lines.join('\n');
}
