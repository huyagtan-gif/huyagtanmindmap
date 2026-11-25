import Link from "next/link";
import { logout, setViewAs, switchUrguu } from "@/app/actions/auth";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { BottomNav, SideNav, ViewAsSelect, type NavItem } from "@/components/Nav";
import { RealtimeProvider } from "@/components/Realtime";
import { LangSwitch } from "@/components/LangSwitch";
import { Avatar, Icon } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { asViewer, requireMember } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const v = await requireMember();
  const t = await getT();
  const { pending, roles } = await asViewer(v, async (q) => {
    let pending = v.perms.has("member.approve")
      ? Number((await q<{ n: string }>("SELECT count(*) AS n FROM membership WHERE urguu_id = app_urguu() AND state = 'pending'"))[0].n)
      : 0;
    if (v.perms.has("data.request")) pending += Number((await q<{ n: string }>("SELECT count(*) AS n FROM data_request WHERE urguu_id = app_urguu() AND state = 'pending'"))[0].n);
    const roles = v.canViewAs ? await q<{ id: string; name: string }>("SELECT id, name FROM role ORDER BY sort") : [];
    return { pending, roles };
  });
  const items: NavItem[] = [
    { href: "/map", name: t("Mind map"), icon: "map" },
    { href: "/people", name: t("Хүмүүс"), icon: "people" },
    { href: "/events", name: t("Үйл ажиллагаа"), icon: "heart", desk: true },
    { href: "/trainings", name: t("Сургалт"), icon: "cap", desk: true },
    { href: "/calendar", name: t("Календарь"), short: t("Хуваарь"), icon: "cal" },
    { href: "/me", name: t("Миний мэдээлэл"), short: t("Би"), icon: "me" },
  ];
  const p = v.perms;
  if (p.has("member.approve") || p.has("invite.send") || p.has("data.request")) items.push({ href: "/admin/approvals", name: t("Бүртгэл батлах"), short: t("Батлах"), icon: "check", badge: pending, admin: true });
  if (p.has("ongod.edit")) items.push({ href: "/admin/ongod", name: t("Онгодын мод"), icon: "home", admin: true });
  if (p.has("settings.manage")) items.push({ href: "/admin/settings", name: t("Тохиргоо"), icon: "gear", admin: true });
  if (p.has("import.run") || p.has("person.merge")) items.push({ href: "/admin/import", name: t("Импорт, нэгтгэл"), icon: "share", admin: true });
  if (p.has("finance.view") || p.has("payment.manage")) items.push({ href: "/admin/finance", name: t("Санхүү"), icon: "money", admin: true });
  if (p.has("audit.view")) items.push({ href: "/admin/audit", name: t("Өөрчлөлтийн түүх"), icon: "log", admin: true });
  if (v.isPlatformAdmin && !v.viewAs) items.push({ href: "/admin/system", name: t("Систем"), icon: "sys", admin: true });
  if (p.has("world.view")) items.splice(2, 0, { href: "/world", name: t("Дэлхийн үрс"), short: t("Дэлхий"), icon: "globe" });
  const name = v.personName || v.email;
  // P2.4: олон өргөөнд гишүүн бол өргөө сэлгэх цэс
  const ug = (compact: boolean) =>
    v.urguus.length > 1 ? (
      <form action={switchUrguu} className="ug" style={compact ? { paddingRight: 4 } : undefined}>
        <span className="mk">{v.urguu.name[0]}</span>
        <AutoSubmitSelect name="urguu" defaultValue={v.urguu.id} aria-label={t("Өргөө сэлгэх")}
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
          <div className="brand"><span className="logo" style={{ color: "#fff" }}><Icon n="map" s={18} /></span>{t("Хуягтан")}</div>
          <div className="col g4">
            <span className="tiny muted" style={{ padding: "0 4px", fontWeight: 600, letterSpacing: ".04em" }}>{t("ӨРГӨӨ")}</span>
            {ug(false)}
          </div>
          <SideNav items={items} mainLabel={t("Үндсэн цэс")} admLabel={t("Удирдлага")} />
          <div className="who">
            <Avatar name={name} size={36} />
            <div className="col" style={{ minWidth: 0, flex: 1 }}>
              <b style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</b>
              <span className="tiny muted">{v.role.name}{v.viewAs ? ` (${t("туршиж харж буй")})` : ""}</span>
            </div>
            <form action={logout}><button className="btn icon sm ghost" aria-label={t("Гарах")} title={t("Гарах")}><Icon n="out" s={18} /></button></form>
          </div>
          {v.canViewAs ? <ViewAsSelect roles={roles} current={v.role.id} action={setViewAs} label={t("Түвшнээр харах")} /> : null}
          <LangSwitch lang={t.lang} />
        </aside>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <header className="topbar">
            {ug(true)}
            <div className="row">
              {v.canViewAs ? <ViewAsSelect compact roles={roles} current={v.role.id} action={setViewAs} label={t("Түвшнээр харах")} /> : null}
              <form action={logout}><button className="btn icon ghost" aria-label={t("Гарах")} style={{ height: 40, width: 40 }}><Icon n="out" s={18} /></button></form>
            </div>
          </header>
          <main className="main" id="main">
            {process.env.APP_ENV === "staging" ? <div className="banner" role="note">{t("Туршилтын орчин (staging). Энд оруулсан өгөгдөл жинхэнэ биш, хэдийд ч устаж болно.")}</div> : null}
            {v.viewAs ? (
              <div className="banner">
                <span>{t("Та «{role}» түвшнээр харж байна. Энэ түвшний хүн яг ийм харагдацтай байна.", { role: v.role.name })}</span>
                <form action={setViewAs}><input type="hidden" name="role" value="" /><button className="btn sm">{t("Өөрийн эрх рүү буцах")}</button></form>
              </div>
            ) : null}
            {children}
          </main>
        </div>
      </div>
      <BottomNav label={t("Үндсэн цэс")} items={items.filter((n) => !n.admin && !n.desk).concat(items.filter((n) => n.admin).slice(0, 1))} />
    </RealtimeProvider>
  );
}
