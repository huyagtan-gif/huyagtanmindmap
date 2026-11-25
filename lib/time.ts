// Огноо, цагийн туслах функцууд. Бүх цаг Улаанбаатарын цагаар (UTC+8, зуны цаггүй) харагдаж, оруулагдана.
const TZ = "Asia/Ulaanbaatar";
const OFFSET = "+08:00";
const D = (d: Date | string) => (typeof d === "string" ? new Date(d) : d);
const sv = (d: Date | string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, ...o }).format(D(d));

export const MONTHS = ["1-р сар", "2-р сар", "3-р сар", "4-р сар", "5-р сар", "6-р сар", "7-р сар", "8-р сар", "9-р сар", "10-р сар", "11-р сар", "12-р сар"];
export const WEEKDAYS = ["Да", "Мя", "Лх", "Пү", "Ба", "Бя", "Ня"];
const WEEKDAY_FULL = ["Ням", "Даваа", "Мягмар", "Лхагва", "Пүрэв", "Баасан", "Бямба"];

/** "2026-12-21T09:00" (Улаанбаатарын цаг) → Date. Буруу бол null. */
export function parseLocal(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return null;
  const d = new Date(`${s}:00${OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Date → <input type="datetime-local">-ийн утга (Улаанбаатарын цагаар). */
export const localInput = (d: Date | string | null | undefined) => (d ? sv(d, { dateStyle: "short", timeStyle: "short" }).replace(" ", "T") : "");
/** "2026-12-21" */
export const ubDay = (d: Date | string) => sv(d, { dateStyle: "short" });
/** "09:00" */
export const fmtTime = (d: Date | string) => sv(d, { timeStyle: "short" });
const WEEKDAY_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12-р сарын 21, Даваа" (lang="en" бол "Mon, Dec 21") */
export function fmtDay(d: Date | string, lang: "mn" | "en" = "mn"): string {
  const [y, m, day] = ubDay(d).split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return lang === "en" ? `${WEEKDAY_EN[wd]}, ${MONTH_EN[m - 1]} ${day}` : `${m}-р сарын ${day}, ${WEEKDAY_FULL[wd]}`;
}
/** "2026-12-21 09:00" эсвэл "2026-12-21 09:00–11:30" */
export function fmtRange(start: Date | string, end?: Date | string | null): string {
  const a = `${ubDay(start)} ${fmtTime(start)}`;
  if (!end) return a;
  return ubDay(start) === ubDay(end) ? `${a}–${fmtTime(end)}` : `${a} – ${ubDay(end)} ${fmtTime(end)}`;
}
/** Улаанбаатарын өдрийн эхлэл (00:00) → Date */
export const dayStart = (ymd: string) => new Date(`${ymd}T00:00:00${OFFSET}`);
export const money = (n: number) => `${Math.round(n).toLocaleString("en-US").replace(/,/g, "’")}₮`;
