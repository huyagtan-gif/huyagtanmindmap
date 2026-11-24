import Link from "next/link";
import { PersonForm } from "@/components/PersonForm";
import { requireMember } from "@/lib/viewer";

export const metadata = { title: "Миний мэдээлэл" };

const ERR: Record<string, string> = {
  name: "Өөрийн нэрээ оруулна уу.",
  email: "Энэ имэйл хаяг өөр хүн дээр бүртгэлтэй байна.",
  save: "Хадгалж чадсангүй. Дахин оролдоно уу.",
};

export default async function Me({ searchParams }: { searchParams: Promise<{ e?: string; saved?: string }> }) {
  const v = await requireMember();
  const sp = await searchParams;
  const p = v.perms;
  const admin = [
    (p.has("member.approve") || p.has("invite.send")) && ["/admin/approvals", "Бүртгэл батлах"],
    p.has("ongod.edit") && ["/admin/ongod", "Онгодын мод"],
    p.has("settings.manage") && ["/admin/settings", "Тохиргоо"],
    (p.has("import.run") || p.has("person.merge")) && ["/admin/import", "Импорт, нэгтгэл"],
    p.has("audit.view") && ["/admin/audit", "Өөрчлөлтийн түүх"],
  ].filter(Boolean) as [string, string][];
  return (
    <>
      <div className="pagehead">
        <div className="col g4"><div className="crumb">{v.urguu.name}</div><h1>Миний мэдээлэл</h1></div>
        <Link className="btn" href={`/people/${v.personId}`}>Профайлаа харах</Link>
      </div>
      {admin.length ? (
        <div className="card p0 show-m">
          {admin.map(([href, name]) => <Link key={href} className="list-item" href={href} style={{ color: "inherit", fontWeight: 600 }}>{name}</Link>)}
        </div>
      ) : null}
      {sp.saved ? <div className="banner ok" role="status">Хадгалагдлаа. Mind map шинэчлэгдсэн.</div> : null}
      {sp.e ? <div className="banner bad" role="alert">{ERR[sp.e] || ERR.save}</div> : null}
      {!v.formCompleted && !sp.saved ? <div className="banner info">Тавтай морил! Бүртгэлийн формоо бөглөөд «Хадгалах» дарна уу. Дараа нь хэдийд ч засаж болно.</div> : null}
      <PersonForm viewer={v} personId={v.personId} returnTo="/me" />
    </>
  );
}
