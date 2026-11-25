import Link from "next/link";
import { logout, setViewAs, switchUrguu } from "@/app/actions/auth";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { BottomNav, SideNav, ViewAsSelect, type NavItem } from "@/components/Nav";
import { RealtimeProvider } from "@/components/Realtime";
import { Avatar, Icon } from "@/components/ui";
import { asViewer, requireMember } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const v = await requireMember();
  const { pending, roles } = await asViewer(v, async (q) => {
    let pending = v.perms.has("member.approve")
      ? Number((await q<{ n: string }>("SELECT count(*) AS n FROM membership WHERE urguu_id = app_urguu() AND state = 'pending'"))[0].n)
      : 0;
    if (v.perms.has("data.request")) pending += Number((await q<{ n: string }>("SELECT count(*) AS n FROM data_request WHERE urguu_id = app_urguu() AND state = 'pending'"))[0].n);
    const roles = v.canViewAs ? await q<{ id: string; name: string }>("SELECT id, name FROM role ORDER BY sort") : [];
    return { pending, roles };
  });
  const items: NavItem[] = [
    { href: "/map", name: "Mind map", icon: "map" },
    { href: "/people", name: "Хүмүүс", icon: "people" },
    { href: "/events", name: "Үйл ажиллагаа", icon: "heart", desk: true },
    { href: "/trainings", name: "Сургалт", icon: "cap", desk: true },
    { href: "/calendar", name: "Календарь", short: "Хуваарь", icon: "cal" },
    { href: "/me", name: "Миний мэдээлэл", short: "Би", icon: "me" },
  ];
  const p = v.perms;
  if (p.has("member.approve") || p.has("invite.send") || p.has("data.request")) items.push({ href: "/admin/approvals", name: "Бүртгэл батлах", short: "Батлах", icon: "check", badge: pending, admin: true });
  if (p.has("ongod.edit")) items.push({ href: "/admin/ongod", name: "Онгодын мод", icon: "home", admin: true });
  if (p.has("settings.manage")) items.push({ href: "/admin/settings", name: "Тохиргоо", icon: "gear", admin: true });
  if (p.has("import.run") || p.has("person.merge")) items.push({ href: "/admin/import", name: "Импорт, нэгтгэл", icon: "share", admin: true });
  if (p.has("finance.view") || p.has("payment.manage")) items.push({ href: "/admin/finance", name: "Санхүү", icon: "money", admin: true });
  if (p.has("audit.view")) items.push({ href: "/admin/audit", name: "Өөрчлөлтийн түүх", icon: "log", admin: true });
  if (v.isPlatformAdmin && !v.viewAs) items.push({ href: "/admin/system", name: "Систем", icon: "sys", admin: true });
  if (p.has("world.view")) items.splice(2, 0, { href: "/world", name: "Дэлхийн үрс", short: "Дэлхий", icon: "globe" });
  const name = v.personName || v.email;
  // P2.4: олон өргөөнд гишүүн бол өргөө сэлгэх цэс
  const ug = (compact: boolean) =>
    v.urguus.length > 1 ? (
      <form action={switchUrguu} className="ug" style={compact ? { paddingRight: 4 } : undefined}>
        <span className="mk">{v.urguu.name[0]}</span>
        <AutoSubmitSelect name="urguu" defaultValue={v.urguu.id} aria-label="Өргөө сэлгэх"
          style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", font: "inherit", fontWeight: 600, color: "inherit", cursor: "pointer", height: 32, maxWidth: compact ? 180 : undefined }}>
          {v.urguus.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </AutoSubmitSelect>
      </form>
    ) : (
      <div className="ug" style={{ cursor: "default" }}><span className="mk">{v.urguu.name[0]}</span><span style={compact ? undefined : { flex: 1 }}>{v.urguu.name}</span></div>
    );
  return (
    <RealtimeProvider>
      <div className="app">
        <aside className="side">
          <div className="brand"><span className="logo" style={{ color: "#fff" }}><Icon n="map" s={18} /></span>Хуягтан</div>
          <div className="col g4">
            <span className="tiny muted" style={{ padding: "0 4px", fontWeight: 600, letterSpacing: ".04em" }}>ӨРГӨӨ</span>
            {ug(false)}
          </div>
          <SideNav items={items} />
          <div className="who">
            <Avatar name={name} size={36} />
            <div className="col" style={{ minWidth: 0, flex: 1 }}>
              <b style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</b>
              <span className="tiny muted">{v.role.name}{v.viewAs ? " (туршиж харж буй)" : ""}</span>
            </div>
            <form action={logout}><button className="btn icon sm ghost" aria-label="Гарах" title="Гарах"><Icon n="out" s={18} /></button></form>
          </div>
          {v.canViewAs ? <ViewAsSelect roles={roles} current={v.role.id} action={setViewAs} /> : null}
        </aside>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <header className="topbar">
            {ug(true)}
            <div className="row">
              {v.canViewAs ? <ViewAsSelect compact roles={roles} current={v.role.id} action={setViewAs} /> : null}
              <form action={logout}><button className="btn icon ghost" aria-label="Гарах" style={{ height: 40, width: 40 }}><Icon n="out" s={18} /></button></form>
            </div>
          </header>
          <main className="main" id="main">
            {process.env.APP_ENV === "staging" ? <div className="banner" role="note">Туршилтын орчин (staging). Энд оруулсан өгөгдөл жинхэнэ биш, хэдийд ч устаж болно.</div> : null}
            {v.viewAs ? (
              <div className="banner">
                <span>Та «{v.role.name}» түвшнээр харж байна. Энэ түвшний хүн яг ийм харагдацтай байна.</span>
                <form action={setViewAs}><input type="hidden" name="role" value="" /><button className="btn sm">Өөрийн эрх рүү буцах</button></form>
              </div>
            ) : null}
            {children}
          </main>
        </div>
      </div>
      <BottomNav items={items.filter((n) => !n.admin && !n.desk).concat(items.filter((n) => n.admin).slice(0, 1))} />
    </RealtimeProvider>
  );
}
