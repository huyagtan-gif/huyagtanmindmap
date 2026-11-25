import type { Q } from "./db";
import { loadPeople } from "./data";
import type { ViewerLike } from "./project";
import type { Opt } from "@/components/Pickers";

export const EVENT_STATE: Record<string, [string, string]> = { planned: ["pri", "Төлөвлөсөн"], done: ["", "Болсон"], cancelled: ["bad", "Цуцалсан"] };
export const RSVP: Record<string, [string, string]> = { invited: ["warn", "Урьсан"], yes: ["ok", "Ирнэ"], no: ["", "Ирэхгүй"], maybe: ["", "Магадгүй"] };

/** Хүн сонгогчийн сонголтууд (нэр + овог). Нууц талбар орохгүй. */
export async function peopleOptions(q: Q, viewer: ViewerLike): Promise<Opt[]> {
  const people = await loadPeople(q, viewer);
  return people.map((p) => ({ id: p.id, label: p.name, sub: p.is_registered ? p.clan_name || undefined : "бүртгэлгүй", search: [p.father_name, p.given_name].filter(Boolean).join(" ") }));
}

/** Сонгогчийн "id:<uuid>" / "new:<нэр>" утгуудыг задлана. */
export function pickerValues(fd: FormData, name: string): { ids: string[]; names: string[] } {
  const ids: string[] = [], names: string[] = [];
  for (const v of fd.getAll(name)) {
    if (typeof v !== "string") continue;
    if (v.startsWith("id:") && /^[0-9a-f-]{36}$/i.test(v.slice(3))) ids.push(v.slice(3));
    else if (v.startsWith("new:") && v.slice(4).trim()) names.push(v.slice(4).trim().slice(0, 120));
  }
  return { ids: [...new Set(ids)], names: [...new Set(names)] };
}
