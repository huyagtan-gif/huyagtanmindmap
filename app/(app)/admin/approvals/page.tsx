import { decideMembership, revokeInvite, sendInvite } from "@/app/actions/admin";
import { decideDeletion } from "@/app/actions/privacy";
import { ConfirmButton } from "@/components/AutoSubmit";
import { Flash } from "@/components/Flash";
import { Avatar, Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/audit-text";
import { displayName } from "@/lib/project";
import { asViewer, requirePerm } from "@/lib/viewer";

export const metadata = { title: "Бүртгэл батлах" };

export default async function Approvals({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const v = await requirePerm("member.approve", "invite.send", "data.request");
  const sp = await searchParams;
  const canApprove = v.perms.has("member.approve");
  const canInvite = v.perms.has("invite.send");
  const canData = v.perms.has("data.request");
  const d = await asViewer(v, async (q) => ({
    pending: canApprove
      ? await q<{ id: string; clan_name: string | null; father_name: string | null; given_name: string; phone: string | null; email: string | null; email_verified: boolean; created_at: Date; role_id: string | null }>(
          `SELECT m.id, p.clan_name, p.father_name, p.given_name, pp.phone, pp.email, coalesce(pp.email_verified, false) AS email_verified, m.created_at, m.role_id
           FROM membership m JOIN person p ON p.id = m.person_id LEFT JOIN person_private pp ON pp.person_id = p.id
           WHERE m.urguu_id = app_urguu() AND m.state = 'pending' ORDER BY m.created_at`)
      : [],
    roles: await q<{ id: string; name: string; is_system: boolean }>("SELECT id, name, is_system FROM role ORDER BY sort"),
    // P2.8: өгөгдлөө устгуулах хүсэлтүүд
    dels: canData
      ? await q<{ id: string; person_id: string; father_name: string | null; given_name: string; note: string | null; created_at: Date }>(
          `SELECT d.id, d.person_id, p.father_name, p.given_name, d.note, d.created_at FROM data_request d JOIN person p ON p.id = d.person_id
           WHERE d.urguu_id = app_urguu() AND d.state = 'pending' ORDER BY d.created_at`)
      : [],
    invites: canInvite
      ? await q<{ id: string; email: string; role: string; expires_at: Date; used_at: Date | null }>(
          `SELECT i.id, i.email, r.name AS role, i.expires_at, i.used_at FROM invite i JOIN role r ON r.id = i.role_id ORDER BY i.created_at DESC LIMIT 50`)
      : [],
  }));
  const roles = d.roles.filter((r) => !r.is_system);
  const defRole = roles[roles.length - 1]?.id;
  // Талбарын эрх: утас, имэйлийг зөвхөн харах эрхтэй түвшинд харуулна.
  const seePhone = v.fields.has("phone"), seeEmail = v.fields.has("email");
  return (
    <>
      <div className="pagehead"><div><div className="crumb">{v.urguu.name}</div><h1>Бүртгэл батлах</h1></div></div>
      <Flash m={sp.m} />
      <div className="split">
        <div className="grow col g16">
          {canData && d.dels.length ? (
            <div className="card p0">
              <div className="col g4" style={{ padding: "16px 16px 8px" }}>
                <h2>Өгөгдлөө устгуулах хүсэлт · {d.dels.length}</h2>
                <span className="small muted">Баталбал тухайн хүний бүртгэл, бүх хувийн мэдээлэл платформоос бүрмөсөн устна. Буцаах боломжгүй.</span>
              </div>
              {d.dels.map((r) => (
                <div key={r.id} className="list-item" style={{ flexWrap: "wrap" }}>
                  <Avatar name={displayName(r)} size={44} />
                  <div className="col" style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <a href={`/people/${r.person_id}`} style={{ fontWeight: 600 }}>{displayName(r)}</a>
                    {r.note ? <span className="small">{r.note}</span> : null}
                    <span className="tiny muted">{fmtDateTime(r.created_at)}</span>
                  </div>
                  <div className="row wrap">
                    {/* Шийдвэрийг товчны name/value-д найдахгүй, тус тусын формын нуугдмал талбараар дамжуулна. */}
                    <form action={decideDeletion}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <ConfirmButton className="btn sm danger" message={`«${displayName(r)}»-ийн бүх өгөгдлийг бүрмөсөн устгах уу? Энэ үйлдлийг буцаах боломжгүй.`}>Баталж устгах</ConfirmButton>
                    </form>
                    <form action={decideDeletion}>
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <button className="btn sm">Татгалзах</button>
                    </form>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          {canApprove ? (
            <div className="card p0">
              <div style={{ padding: "16px 16px 8px" }}><h2>Хүлээгдэж буй хүсэлт · {d.pending.length}</h2></div>
              {d.pending.length ? d.pending.map((p) => (
                <div key={p.id} className="list-item" style={{ flexWrap: "wrap" }}>
                  <Avatar name={displayName(p)} size={44} />
                  <div className="col" style={{ flex: "1 1 220px", minWidth: 0 }}>
                    <b>{[p.clan_name, p.father_name, p.given_name].filter(Boolean).join(" ")}</b>
                    <span className="small muted">{[seePhone ? p.phone : null, seeEmail ? p.email : null].filter(Boolean).join(" · ") || "—"}</span>
                    <span className="row wrap tiny muted" style={{ gap: 6 }}>
                      {fmtDateTime(p.created_at)}
                      <span className={`chip ${p.email_verified ? "ok" : "warn"}`} style={{ height: 20 }}>{p.email_verified ? "Имэйл баталгаажсан" : "Имэйл баталгаажаагүй"}</span>
                    </span>
                  </div>
                  <form action={decideMembership} className="row wrap">
                    <input type="hidden" name="membership_id" value={p.id} />
                    <select className="inp sm" name="role_id" defaultValue={p.role_id || defRole} style={{ width: "auto" }} aria-label="Түвшин">
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <button className="btn sm pri" name="decision" value="approve">Батлах</button>
                    <ConfirmButton className="btn sm danger" name="decision" value="reject" message="Энэ хүсэлтийг татгалзах уу?">Татгалзах</ConfirmButton>
                  </form>
                </div>
              )) : <div style={{ padding: 16 }}><Empty title="Хүлээгдэж буй хүсэлт алга">Шинэ хүн бүртгүүлэхэд энд гарч ирнэ.</Empty></div>}
            </div>
          ) : null}
        </div>
        {canInvite ? (
          <div className="aside">
            <form action={sendInvite} className="card col g12">
              <h2>Урилга илгээх</h2>
              <span className="small muted">Урилгаар орсон хүн батлалгүй шууд нэвтэрнэ. Холбоос 7 хоног хүчинтэй, нэг удаагийн.</span>
              <label className="field">Имэйл<input className="inp" type="email" name="email" required /></label>
              <label className="field">Түвшин
                <select className="inp" name="role_id" defaultValue={defRole}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
              </label>
              <button className="btn pri">Урилга илгээх</button>
            </form>
            <div className="card p0">
              <div style={{ padding: "16px 16px 8px" }}><h2>Илгээсэн урилга</h2></div>
              {d.invites.length ? d.invites.map((i) => {
                const state = i.used_at ? ["ok", "Ашигласан"] : new Date(i.expires_at) < new Date() ? ["bad", "Хугацаа дууссан"] : ["warn", "Хүлээгдэж буй"];
                return (
                  <div key={i.id} className="list-item">
                    <div className="col" style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ overflowWrap: "anywhere" }}>{i.email}</b>
                      <span className="tiny muted">{i.role} · {fmtDateTime(i.expires_at)} хүртэл</span>
                    </div>
                    <span className={`chip ${state[0]}`} style={{ height: 22 }}>{state[1]}</span>
                    {i.used_at ? null : <form action={revokeInvite}><input type="hidden" name="id" value={i.id} /><button className="btn sm ghost" aria-label="Цуцлах">×</button></form>}
                  </div>
                );
              }) : <div style={{ padding: 16 }}><Empty title="Урилга алга" /></div>}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
