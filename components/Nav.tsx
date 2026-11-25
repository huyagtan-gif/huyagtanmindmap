"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./ui";

export type NavItem = { href: string; name: string; short?: string; icon: string; badge?: number; admin?: boolean; /** зөвхөн өргөн дэлгэцийн цэсэнд (утсанд Календариас орно) */ desk?: boolean };

const isOn = (path: string, href: string) => path === href || path.startsWith(href + "/");

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const link = (n: NavItem) => (
    <Link key={n.href} className={`nav${isOn(path, n.href) ? " on" : ""}`} href={n.href} aria-current={isOn(path, n.href) ? "page" : undefined}>
      <Icon n={n.icon} />
      <span>{n.name}</span>
      {n.badge ? <span className="badge">{n.badge}</span> : null}
    </Link>
  );
  const main = items.filter((n) => !n.admin);
  const adm = items.filter((n) => n.admin);
  return (
    <>
      <nav className="navg" aria-label="Үндсэн цэс">{main.map(link)}</nav>
      {adm.length ? (
        <nav className="navg" aria-label="Удирдлага">
          <span className="lbl">УДИРДЛАГА</span>
          {adm.map(link)}
        </nav>
      ) : null}
    </>
  );
}

export function BottomNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="bnav" aria-label="Үндсэн цэс">
      {items.map((n) => (
        <Link key={n.href} href={n.href} className={isOn(path, n.href) ? "on" : ""}>
          <Icon n={n.icon} s={22} />
          {n.short || n.name}
          {n.badge ? <span className="badge">{n.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

/** P1.15 Түвшнээр харах сэлгүүр: сонгоход шууд илгээнэ. */
export function ViewAsSelect({ roles, current, action, compact }: { roles: { id: string; name: string }[]; current: string; action: (fd: FormData) => void; compact?: boolean }) {
  const path = usePathname();
  return (
    <form action={action} className={compact ? undefined : "viewas"}>
      <input type="hidden" name="next" value={path} />
      {compact ? null : <span>Түвшнээр харах:</span>}
      <select
        name="role"
        aria-label="Түвшнээр харах"
        defaultValue={current}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        style={compact ? { height: 36, border: "1px dashed var(--line2)", borderRadius: 10, background: "var(--card)", fontSize: 13, fontWeight: 600, padding: "0 8px" } : undefined}
      >
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </form>
  );
}
