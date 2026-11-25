import Link from "next/link";
import {
  deleteListItem, deleteQuestion, deleteRole, saveFieldPermissions, saveGrants, saveListItem, savePermissions, saveQuestion, saveRole, saveRoleViews, setMemberRole,
} from "@/app/actions/admin";
import { AutoSubmitSelect, ConfirmButton } from "@/components/AutoSubmit";
import { Flash } from "@/components/Flash";
import { PAL_NAMES, SHAPES, Shape } from "@/components/ui";
import { loadLookups } from "@/lib/data";
import { FIELD_KEYS, PERMISSIONS, VIEWS } from "@/lib/fields";
import { displayName } from "@/lib/project";
import { sys } from "@/lib/db";
import { asViewer, requirePerm } from "@/lib/viewer";

export const metadata = { title: "Тохиргоо" };

const TABS = [
  ["statuses", "Явцын төлөв"], ["roles", "Түвшин, эрх"], ["fields", "Талбарын эрх"], ["members", "Гишүүдийн түвшин"],
  ["deedes", "Дээдэс"], ["lists", "Жагсаалтууд"], ["events", "Үйл, сургалт"], ["questions", "Формын асуулт"], ["grants", "Өргөө хоорондын эрх"],
] as const;
const QTYPES = [["text", "Богино бичвэр"], ["longtext", "Урт бичвэр"], ["yesno", "Тийм / Үгүй"], ["choice", "Сонголт"], ["date", "Огноо"]];

type Item = { id: string; name: string; sort: number; active: boolean; [k: string]: any };

function ListEditor({ table, tab, title, hint, items, extra }: { table: string; tab: string; title: string; hint?: string; items: Item[]; extra?: (it?: Item) => React.ReactNode }) {
  const row = (it?: Item) => (
    <form action={saveListItem} className="row wrap" key={it?.id || "new"} style={{ padding: "10px 16px", borderBottom: "1px solid var(--sunk)", alignItems: "flex-end" }}>
      <input type="hidden" name="table" value={table} /><input type="hidden" name="tab" value={tab} />
      {it ? <input type="hidden" name="id" value={it.id} /> : null}
      <label className="field" style={{ flex: "2 1 180px" }}><span className="tiny muted">Нэр</span><input className="inp sm" name="name" required defaultValue={it?.name || ""} placeholder={it ? "" : "Шинээр нэмэх"} maxLength={120} /></label>
      {extra?.(it)}
      <label className="field" style={{ width: 72 }}><span className="tiny muted">Эрэмбэ</span><input className="inp sm" type="number" name="sort" defaultValue={it?.sort ?? items.length + 1} /></label>
      {it ? <label className="row small" style={{ gap: 6, height: 36 }}><input type="checkbox" name="active" defaultChecked={it.active} />Идэвхтэй</label> : null}
      <button className={`btn sm ${it ? "" : "pri"}`}>{it ? "Хадгалах" : "Нэмэх"}</button>
      {it ? <ConfirmButton className="btn sm danger" formAction={deleteListItem} message={`«${it.name}»-г устгах уу? Ашиглагдаж байгаа бол идэвхгүй болно.`}>Устгах</ConfirmButton> : null}
    </form>
  );
  return (
    <div className="card p0">
      <div className="col g4" style={{ padding: "16px 16px 8px" }}><h2>{title}</h2>{hint ? <span className="small muted">{hint}</span> : null}</div>
      {items.map((it) => row(it))}
      {row()}
    </div>
  );
}

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string; m?: string }> }) {
  const v = await requirePerm("settings.manage");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : "statuses";
  const d = await asViewer(v, async (q) => ({
    lk: await loadLookups(q),
    perms: await q<{ role_id: string; key: string }>("SELECT role_id, key FROM permission"),
    fperms: await q<{ role_id: string; field_key: string }>("SELECT role_id, field_key FROM field_permission"),
    rviews: await q<{ role_id: string; view: string }>("SELECT role_id, view FROM role_view"),
    etypes: tab === "events" ? await q<Item>("SELECT id, name, sort, active FROM event_type ORDER BY sort, name") : [],
    eroles: tab === "events" ? await q<Item>("SELECT id, name, sort, active FROM event_role ORDER BY sort, name") : [],
    questions: tab === "questions" ? await q<any>("SELECT * FROM form_question WHERE urguu_id = app_urguu() ORDER BY sort, text") : [],
    members: tab === "members"
      ? await q<{ person_id: string; father_name: string | null; given_name: string; role_id: string | null }>(
          `SELECT m.person_id, p.father_name, p.given_name, m.role_id FROM membership m JOIN person p ON p.id = m.person_id
           WHERE m.urguu_id = app_urguu() AND m.state = 'approved' AND p.merged_into_id IS NULL ORDER BY p.given_name`)
      : [],
  }));
  const { lk } = d;
  // Өргөөний нэрс нууц биш; апп-ын role зөвхөн өөрийн өргөөг хардаг тул жагсаалтыг системийн холболтоор авна.
  const others = tab === "grants" ? await sys<{ id: string; name: string }>("SELECT id, name FROM urguu WHERE state = 'active' AND id <> $1 ORDER BY created_at", [v.urguu.id]) : [];
  const grants = tab === "grants" ? await asViewer(v, (q) => q<{ owner_urguu_id: string; grantee_urguu_id: string }>("SELECT owner_urguu_id, grantee_urguu_id FROM cross_urguu_grant")) : [];
  const given = new Set(grants.filter((g) => g.owner_urguu_id === v.urguu.id).map((g) => g.grantee_urguu_id));
  const received = new Set(grants.filter((g) => g.grantee_urguu_id === v.urguu.id).map((g) => g.owner_urguu_id));
  const has = new Set(d.perms.map((p) => `${p.role_id}:${p.key}`));
  const fhas = new Set(d.fperms.map((p) => `${p.field_key}:${p.role_id}`));
  const vhas = new Set(d.rviews.map((p) => `${p.role_id}:${p.view}`));
  const mySystem = lk.roles.find((r) => r.id === v.realRole?.id)?.is_system;
  return (
    <>
      <div className="pagehead"><div><div className="crumb">{v.urguu.name}</div><h1>Тохиргоо</h1></div></div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, n]) => <Link key={k} href={`/admin/settings?tab=${k}`} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""}>{n}</Link>)}
      </div>
      <Flash m={sp.m} />

      {tab === "statuses" ? (
        <ListEditor table="status" tab="statuses" title="Явцын төлөв" hint="Бүх өргөөнд нийтлэг. Эрэмбээр нь Kanban самбарын багана, профайлын шат болно." items={lk.statuses}
          extra={(it) => (
            <>
              <label className="field" style={{ flex: "2 1 180px" }}><span className="tiny muted">Тайлбар</span><input className="inp sm" name="description" defaultValue={it?.description || ""} maxLength={200} /></label>
              <label className="field"><span className="tiny muted">Өнгө</span>
                <select className="inp sm" name="pal" defaultValue={it?.pal ?? 4}>{PAL_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}</select>
              </label>
              <label className="field"><span className="tiny muted">Дүрс {it ? <Shape st={it as any} s={12} /> : null}</span>
                <select className="inp sm" name="shape" defaultValue={it?.shape || "dot"}>{SHAPES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
              </label>
            </>
          )} />
      ) : null}

      {tab === "deedes" ? (
        <ListEditor table="deedes" tab="deedes" title="Хуягласан дээдэс" hint="Платформын нийтлэг жагсаалт. Энд нэмсэн дээдэс энэ өргөөний формд сонголт болж гарна." items={lk.deedes}
          extra={(it) => <label className="field" style={{ flex: "2 1 180px" }}><span className="tiny muted">Тайлбар</span><input className="inp sm" name="description" defaultValue={it?.description || ""} maxLength={300} /></label>} />
      ) : null}

      {tab === "lists" ? (
        <>
          <ListEditor table="knowledge_level" tab="lists" title="Мэдлэгийн түвшин" items={lk.knowledge} />
          <ListEditor table="huyag_type" tab="lists" title="Хуягийн төрөл" items={lk.huyagTypes} />
          <ListEditor table="era" tab="lists" title="Цаг үе" items={lk.eras} />
          <ListEditor table="relation_type" tab="lists" title="Хүн хоорондын холбооны төрөл" hint="Эхний дөрөв (Багш–шавь, Танилцуулсан, Түшсэн, Мэдээлэл өгдөг) формд ашиглагддаг." items={lk.relationTypes} />
        </>
      ) : null}

      {tab === "events" ? (
        <div className="col g16">
          <ListEditor table="event_type" tab="events" title="Үйлийн төрөл" hint="Үйл ажиллагаа үүсгэхэд сонгогдоно (жишээ нь Тахилга, Золгох ёслол)." items={d.etypes} />
          <ListEditor table="event_role" tab="events" title="Оролцогчийн үүрэг" hint="Үйлд оролцогч нэмэхэд сонгогдоно. Эрэмбээр хамгийн сүүлийнх нь анхдагч үүрэг болно." items={d.eroles} />
        </div>
      ) : null}
      {tab === "roles" ? (
        <>
          <div className="card p0">
            <div style={{ padding: "16px 16px 8px" }}><h2>Түвшин</h2></div>
            {[...lk.roles, null].map((r) => (
              <form action={saveRole} key={r?.id || "new"} className="row wrap" style={{ padding: "10px 16px", borderBottom: "1px solid var(--sunk)", alignItems: "flex-end" }}>
                {r ? <input type="hidden" name="id" value={r.id} /> : null}
                <label className="field" style={{ flex: "2 1 180px" }}><span className="tiny muted">Нэр</span><input className="inp sm" name="name" required defaultValue={r?.name || ""} placeholder={r ? "" : "Шинэ түвшин"} maxLength={60} /></label>
                <label className="field" style={{ width: 72 }}><span className="tiny muted">Эрэмбэ</span><input className="inp sm" type="number" name="sort" defaultValue={r?.sort ?? lk.roles.length + 1} /></label>
                <button className={`btn sm ${r ? "" : "pri"}`}>{r ? "Хадгалах" : "Нэмэх"}</button>
                {r && !r.is_system ? <ConfirmButton className="btn sm danger" formAction={deleteRole} message={`«${r.name}» түвшинг устгах уу?`}>Устгах</ConfirmButton> : null}
                {r?.is_system ? <span className="chip gold" style={{ height: 22 }}>Системийн · устгагдахгүй</span> : null}
              </form>
            ))}
          </div>
          <form action={savePermissions} className="card p0">
            <div className="col g4" style={{ padding: "16px 16px 8px" }}><h2>Үйлдлийн эрх</h2><span className="small muted">Супер админ үргэлж бүх эрхтэй.</span></div>
            <div className="tscroll">
              <table className="t">
                <thead><tr><th>Үйлдэл</th>{lk.roles.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
                <tbody>
                  {PERMISSIONS.map((p) => (
                    <tr key={p.key}>
                      <td>{p.name}</td>
                      {lk.roles.map((r) => <td key={r.id}><input type="checkbox" name={`p:${r.id}:${p.key}`} defaultChecked={r.is_system || has.has(`${r.id}:${p.key}`)} disabled={r.is_system} aria-label={`${r.name}: ${p.name}`} style={{ width: 18, height: 18, accentColor: "var(--pri)" }} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 16 }}><button className="btn pri">Эрх хадгалах</button></div>
          </form>
          <form action={saveRoleViews} className="card p0">
            <div className="col g4" style={{ padding: "16px 16px 8px" }}><h2>Mind map-ийн харагдац</h2><span className="small muted">Чагтгүй түвшинд тухайн харагдацын таб гарахгүй.</span></div>
            <div className="tscroll">
              <table className="t">
                <thead><tr><th>Харагдац</th>{lk.roles.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
                <tbody>
                  {VIEWS.map((x) => (
                    <tr key={x.key}>
                      <td>{x.name}</td>
                      {lk.roles.map((r) => <td key={r.id}><input type="checkbox" name={`v:${r.id}:${x.key}`} defaultChecked={r.is_system || vhas.has(`${r.id}:${x.key}`)} disabled={r.is_system} aria-label={`${r.name}: ${x.name}`} style={{ width: 18, height: 18, accentColor: "var(--pri)" }} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 16 }}><button className="btn pri">Харагдац хадгалах</button></div>
          </form>
        </>
      ) : null}

      {tab === "fields" ? (
        <form action={saveFieldPermissions} className="card p0">
          <div className="col g4" style={{ padding: "16px 16px 8px" }}>
            <h2>Талбарын харах эрх</h2>
            <span className="small muted">Чагтгүй түвшинд тухайн талбар «Нууцлагдсан» гэж харагдана, утга нь хөтөч рүү огт очихгүй. Хүн өөрийн мэдээллийг үргэлж харна.</span>
          </div>
          <div className="tscroll">
            <table className="t">
              <thead><tr><th>Талбар</th>{lk.roles.map((r) => <th key={r.id}>{r.name}</th>)}</tr></thead>
              <tbody>
                {FIELD_KEYS.map((f) => (
                  <tr key={f.key}>
                    <td>{f.name}</td>
                    {lk.roles.map((r) => <td key={r.id}><input type="checkbox" name={`f:${f.key}:${r.id}`} defaultChecked={r.is_system || fhas.has(`${f.key}:${r.id}`)} disabled={r.is_system} aria-label={`${r.name}: ${f.name}`} style={{ width: 18, height: 18, accentColor: "var(--pri)" }} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: 16 }}><button className="btn pri">Талбарын эрх хадгалах</button></div>
        </form>
      ) : null}

      {tab === "members" ? (
        <div className="card p0">
          <div className="col g4" style={{ padding: "16px 16px 8px" }}><h2>Гишүүдийн түвшин</h2><span className="small muted">Сонгоход шууд хадгалагдана.</span></div>
          {d.members.map((m) => {
            const cur = lk.roles.find((r) => r.id === m.role_id);
            const locked = m.person_id === v.personId || (cur?.is_system && !mySystem);
            return (
              <form action={setMemberRole} key={m.person_id} className="list-item" style={{ minHeight: 52 }}>
                <input type="hidden" name="person_id" value={m.person_id} />
                <Link href={`/people/${m.person_id}`} style={{ flex: 1, fontWeight: 600 }}>{displayName(m)}</Link>
                <AutoSubmitSelect className="inp sm" name="role_id" defaultValue={m.role_id || ""} disabled={locked} style={{ width: "auto" }} aria-label="Түвшин">
                  {lk.roles.filter((r) => !r.is_system || mySystem || r.id === m.role_id).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </AutoSubmitSelect>
              </form>
            );
          })}
        </div>
      ) : null}

      {tab === "questions" ? (
        <div className="card p0">
          <div className="col g4" style={{ padding: "16px 16px 8px" }}>
            <h2>{v.urguu.name} · формын нэмэлт асуулт</h2>
            <span className="small muted">Үндсэн 25 асуулт бүх өргөөнд нийтлэг. Энд нэмсэн асуулт зөвхөн энэ өргөөний формын төгсгөлд гарна.</span>
          </div>
          {[...d.questions, null].map((qq: any) => (
            <form action={saveQuestion} key={qq?.id || "new"} className="row wrap" style={{ padding: "10px 16px", borderBottom: "1px solid var(--sunk)", alignItems: "flex-end" }}>
              {qq ? <input type="hidden" name="id" value={qq.id} /> : null}
              <label className="field" style={{ flex: "3 1 240px" }}><span className="tiny muted">Асуулт</span><input className="inp sm" name="text" required defaultValue={qq?.text || ""} placeholder={qq ? "" : "Шинэ асуулт"} maxLength={300} /></label>
              <label className="field"><span className="tiny muted">Төрөл</span>
                <select className="inp sm" name="type" defaultValue={qq?.type || "text"}>{QTYPES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
              </label>
              <label className="field" style={{ flex: "2 1 160px" }}><span className="tiny muted">Сонголтууд (таслалаар)</span><input className="inp sm" name="options" defaultValue={(qq?.options || []).join(", ")} /></label>
              <label className="field" style={{ width: 72 }}><span className="tiny muted">Эрэмбэ</span><input className="inp sm" type="number" name="sort" defaultValue={qq?.sort ?? d.questions.length + 1} /></label>
              <label className="row small" style={{ gap: 6, height: 36 }}><input type="checkbox" name="required" defaultChecked={qq?.required} />Заавал</label>
              {qq ? <label className="row small" style={{ gap: 6, height: 36 }}><input type="checkbox" name="active" defaultChecked={qq.active} />Идэвхтэй</label> : null}
              <button className={`btn sm ${qq ? "" : "pri"}`}>{qq ? "Хадгалах" : "Нэмэх"}</button>
              {qq ? <ConfirmButton className="btn sm danger" formAction={deleteQuestion} message="Асуултыг хариултуудтай нь устгах уу?">Устгах</ConfirmButton> : null}
            </form>
          ))}
        </div>
      ) : null}

      {tab === "grants" ? (
        <form action={saveGrants} className="card p0">
          <div className="col g4" style={{ padding: "16px 16px 8px" }}>
            <h2>Өргөө хоорондын харах эрх</h2>
            <span className="small muted">
              Чагталсан өргөөний «Дэлхийн үрс харах» эрхтэй гишүүд {v.urguu.name}-ийн бүртгэлтэй хүмүүсийн нэр, явцын төлөв, онгодыг харна.
              Утас, имэйл, тэмдэглэл зэрэг нууц талбар өргөө дамжиж хэзээ ч харагдахгүй.
            </span>
          </div>
          {others.length ? others.map((u) => (
            <label key={u.id} className="list-item" style={{ minHeight: 52, cursor: "pointer" }}>
              <input type="checkbox" name="grantee" value={u.id} defaultChecked={given.has(u.id)} style={{ width: 18, height: 18, accentColor: "var(--pri)" }} />
              <span style={{ flex: 1, fontWeight: 600 }}>{u.name}</span>
              {received.has(u.id) ? <span className="chip ok" style={{ height: 22 }}>Тэд бидэнд харуулдаг</span> : null}
            </label>
          )) : <div className="empty"><b>Өөр өргөө алга</b><span>Платформд өөр идэвхтэй өргөө үүсэхэд энд гарна.</span></div>}
          {others.length ? <div style={{ padding: 16 }}><button className="btn pri">Хадгалах</button></div> : null}
        </form>
      ) : null}
    </>
  );
}
