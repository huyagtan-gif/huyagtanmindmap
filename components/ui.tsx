import type { ReactNode } from "react";

export const PAL = [
  { c: "#6B7585", s: "#EDEFF2", i: "#4A5464" }, { c: "#B06A08", s: "#FBF0DE", i: "#7E4A05" },
  { c: "#6E3FB0", s: "#F0E9FA", i: "#5B3196" }, { c: "#19794E", s: "#E3F3EB", i: "#146240" },
  { c: "#1E4FA0", s: "#E6EDF8", i: "#173F82" }, { c: "#B3322C", s: "#FCEBEA", i: "#9E2B26" },
  { c: "#0E7490", s: "#E0F2F6", i: "#0B5D73" },
];
export const pal = (i?: number | null) => PAL[(i ?? 0) % PAL.length] ?? PAL[0];
export const PAL_NAMES = ["Саарал", "Шар хүрэн", "Нил ягаан", "Ногоон", "Цэнхэр", "Улаан", "Номин"];
export const SHAPES = [
  { id: "dash", name: "Тасархай дугуй" }, { id: "clock", name: "Цаг" }, { id: "half", name: "Хагас дугуй" },
  { id: "check", name: "Чагт" }, { id: "dot", name: "Цэг" },
];

const I: Record<string, ReactNode> = {
  map: <><circle cx="12" cy="5" r="2.5" /><circle cx="5" cy="18" r="2.5" /><circle cx="19" cy="18" r="2.5" /><path d="M12 7.5v4M12 11.5L6.5 16M12 11.5l5.5 4.5" /></>,
  people: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2" /></>,
  me: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4.2-6.5 8-6.5s7 2.5 8 6.5" /></>,
  check: <path d="M20 6L9 17l-5-5" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>,
  home: <path d="M3 20h18M5 20V10l7-5 7 5v10M10 20v-5h4v5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  back: <path d="M15 5l-7 7 7 7" />,
  right: <path d="M9 5l7 7-7 7" />,
  down: <path d="M6 9l6 6 6-6" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3.5 7l8.5 6 8.5-6" /></>,
  log: <path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  share: <path d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />,
  out: <path d="M9 4H5v16h4M14 8l4 4-4 4M18 12H9" />,
  sys: <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.300 6.400-3.800 9c-2.500-2.600-3.800-5.600-3.800-9S9.500 5.600 12 3z" /></>,
  down2: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  cal: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  cap: <><path d="M2.5 9.5L12 5l9.5 4.500L12 14z" /><path d="M6.500 12v4.500c1.500 1.500 3.300 2.200 5.500 2.200s4-.700 5.500-2.200V12M21.500 9.500v5" /></>,
  pin: <><path d="M12 21s-6.500-5.600-6.500-10.500a6.500 6.500 0 0 1 13 0C18.500 15.400 12 21 12 21z" /><circle cx="12" cy="10.500" r="2.300" /></>,
  heart: <path d="M12 20s-7.500-4.600-7.500-10A4.300 4.300 0 0 1 12 7.500 4.300 4.300 0 0 1 19.500 10c0 5.400-7.500 10-7.500 10z" />,
  qr: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2.500v2.500H14zM17.500 17.500H20V20h-2.500zM14 19.500h1M19.500 14h.5" /></>,
  money: <><rect x="3" y="6" width="18" height="12" rx="2.500" /><circle cx="12" cy="12" r="2.500" /><path d="M6.500 9.500v.01M17.500 14.500v.01" /></>,
  bell: <path d="M6 16.500V11a6 6 0 0 1 12 0v5.500l1.500 2h-15zM10 20.500a2 2 0 0 0 4 0" />,
};

export function Icon({ n, s = 20, w = 2 }: { n: string; s?: number; w?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {I[n]}
    </svg>
  );
}

export type StatusLike = { name: string; pal: number; shape: string } | null | undefined;

export function Shape({ st, s = 14 }: { st: StatusLike; s?: number }) {
  const c = pal(st?.pal).c;
  switch (st?.shape) {
    case "check":
      return <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill={c} /><path d="M5 8.2l2 2 4-4.2" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
    case "half":
      return <svg width={s} height={s} viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke={c} strokeWidth="2" /><path d="M8 2a6 6 0 0 1 0 12z" fill={c} /></svg>;
    case "clock":
      return <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>;
    case "dash":
      return <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke={c} strokeWidth="2" strokeDasharray="2.5 2" aria-hidden="true"><circle cx="8" cy="8" r="6" /></svg>;
    default:
      return <span className="dot" style={{ background: c, width: s - 4, height: s - 4 }} />;
  }
}

export function StatusChip({ st }: { st: StatusLike }) {
  if (!st) return <span className="chip">—</span>;
  const p = pal(st.pal);
  return <span className="chip" style={{ background: p.s, color: p.i }}><Shape st={st} s={13} />{st.name}</span>;
}

export function initials(name: string): string {
  const a = name.replace(/\(.*\)/, "").trim().split(".");
  return a.length > 1 ? a[0][0] + (a[1].trim()[0] || "") : name.slice(0, 2);
}

export function Avatar({ name, st, size = 36 }: { name: string; st?: StatusLike; size?: number }) {
  const c = st ? pal(st.pal) : PAL[4];
  return <span className="av" style={{ width: size, height: size, background: c.s, color: c.i, fontSize: Math.round(size * 0.38) }}>{initials(name)}</span>;
}

export function Locked() {
  return <span className="lock"><Icon n="lock" s={12} w={2.4} />Нууцлагдсан</span>;
}

/** Огнооны дөрвөлжин тэмдэг (өдөр + сар). */
export function DateBadge({ ymd }: { ymd: string }) {
  const [, m, d] = ymd.split("-").map(Number);
  return <span className="datebadge"><b>{d}</b><span>{m}-р сар</span></span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><b>{title}</b>{children ? <span>{children}</span> : null}</div>;
}
