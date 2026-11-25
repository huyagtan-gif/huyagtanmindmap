import Link from "next/link";
import { addPerson } from "@/app/actions/person";
import { Avatar, Icon, Locked, Shape, StatusChip } from "@/components/ui";
import { loadPeopleList, type ListFilter } from "@/lib/people-list";
import { asViewer, requirePerm } from "@/lib/viewer";

export const metadata = { title: "Хүмүүс" };

export default async function People({ searchParams }: { searchParams: Promise<ListFilter & { add?: string; e?: string }> }) {
  const v = await requirePerm("person.view");
  const f = await searchParams;
  const { rows, lk, ongods, total, counts } = await asViewer(v, (q) => loadPeopleList(q, v, f));
  const stBy = new Map(lk.statuses.map((s) => [s.id, s]));
  const kBy = new Map(lk.knowledge.map((s) => [s.id, s.name]));
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, val] of Object.entries({ q: f.q, st: f.st, era: f.era, ongod: f.ongod, reg: f.reg, sort: f.sort, dir: f.dir, ...patch })) if (val) p.set(k, val);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const th = (key: string, label: string) => {
    const on = (f.sort || "name") === key;
    return <th><Link className="th-sort" href={`/people${qs({ sort: key, dir: on && f.dir !== "desc" ? "desc" : undefined })}`}>{label}{on ? (f.dir === "desc" ? " ↓" : " ↑") : ""}</Link></th>;
  };
  const canEdit = v.perms.has("person.edit");
  const hiddenCol = (k: string) => rows.length > 0 && rows.every((r) => r.hidden.includes(k) && !r.is_self);
  const noPhone = hiddenCol("phone");
  return (
    <>
      <div className="pagehead">
        <div><div className="crumb">{v.urguu.name}</div><h1>Хүмүүс</h1></div>
        <div className="row wrap">
          <form className="row wrap" action="/people" style={{ flex: "1 1 220px" }}>
            {(["st", "era", "ongod", "reg", "sort", "dir"] as const).map((k) => (f[k] ? <input key={k} type="hidden" name={k} value={f[k]} /> : null))}
            <label className="search" style={{ width: 320, maxWidth: "100%", flex: "1 1 220px" }}>
              <Icon n="search" s={16} /><input type="search" name="q" placeholder="Нэр, овог, онгодоор хайх" defaultValue={f.q || ""} aria-label="Хайх" />
            </label>
          </form>
          {v.perms.has("export.csv") ? <a className="btn" href={`/people/export${qs({})}`}><Icon n="share" s={16} /><span className="hide-m">CSV</span></a> : null}
          {v.perms.has("export.csv") ? <a className="btn" href={`/people/export${qs({ format: "xlsx" })}`}><Icon n="down2" s={16} /><span className="hide-m">Excel</span></a> : null}
          {canEdit ? <Link className="btn pri" href="/people?add=1"><Icon n="plus" s={16} w={2.4} /><span className="hide-m">Хүн нэмэх</span></Link> : null}
        </div>
      </div>

      {f.e ? <div className="banner bad" role="alert">{f.e === "email" ? "Энэ имэйл хаяг өөр хүн дээр бүртгэлтэй байна." : "Нэрээ оруулна уу."}</div> : null}
      {canEdit && f.add ? (
        <form action={addPerson} className="card col g12">
          <h2>Хүн нэмэх</h2>
          <div className="formgrid">
            <label className="field">Эцгийн нэр<input className="inp" name="father_name" maxLength={80} /></label>
            <label className="field"><span>Өөрийн нэр <span className="req">*</span></span><input className="inp" name="given_name" required maxLength={80} autoFocus /></label>
            <label className="field">Явцын төлөв
              <select className="inp" name="status_id">{lk.statuses.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            </label>
            <label className="field">Утас<input className="inp" name="phone" inputMode="tel" maxLength={24} /></label>
            <label className="field">Имэйл<span className="hint">Энэ хаягаар нэвтэрвэл батлалгүй шууд орно.</span><input className="inp" type="email" name="email" maxLength={254} /></label>
          </div>
          <div className="row"><button className="btn pri" type="submit">Нэмээд дэлгэрэнгүйг бөглөх</button><Link className="btn" href="/people">Болих</Link></div>
        </form>
      ) : null}

      <div className="row wrap">
        <Link className={`fchip${!f.st ? " on" : ""}`} href={`/people${qs({ st: undefined })}`}>Бүгд · {total}</Link>
        {lk.statuses.filter((s) => s.active).map((s) => (
          <Link key={s.id} className={`fchip${f.st === s.id ? " on" : ""}`} href={`/people${qs({ st: s.id })}`}><Shape st={s} s={13} />{s.name} · {counts[s.id] || 0}</Link>
        ))}
      </div>
      <form action="/people" className="row wrap">
        {(["q", "st", "sort", "dir"] as const).map((k) => (f[k] ? <input key={k} type="hidden" name={k} value={f[k]} /> : null))}
        <select className="inp sm" name="era" defaultValue={f.era || ""} style={{ width: "auto" }} aria-label="Цаг үе">
          <option value="">Цаг үе: бүгд</option>{lk.eras.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <select className="inp sm" name="ongod" defaultValue={f.ongod || ""} style={{ width: "auto", maxWidth: 220 }} aria-label="Онгод">
          <option value="">Онгод: бүгд</option>{ongods.filter((o) => o.kind === "ongod").map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select className="inp sm" name="reg" defaultValue={f.reg || ""} style={{ width: "auto" }} aria-label="Бүртгэл">
          <option value="">Бүртгэлтэй гишүүд</option><option value="0">Бүртгэлгүй (нэрээр дурдагдсан)</option><option value="all">Бүгд</option>
        </select>
        <button className="btn sm" type="submit">Шүүх</button>
        {f.q || f.era || f.ongod || f.reg || f.st ? <Link className="btn sm ghost" href="/people">Цэвэрлэх</Link> : null}
        <span className="small muted">{rows.length} илэрц</span>
      </form>

      <div className="card p0">
        <div className="tscroll hide-m">
          <table className="t">
            <thead><tr>{th("name", "Нэр")}{th("status", "Төлөв")}{th("ongod", "Эрэмбийн онгод")}<th>Түшсэн</th>{th("huyag", "Хуягийн огноо")}<th>Мэдлэг</th>{noPhone ? null : <th>Утас</th>}</tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="row">
                      <Avatar name={p.name} st={stBy.get(p.status_id || "")} size={32} />
                      <span className="col">
                        <Link href={`/people/${p.id}`} style={{ fontWeight: 600 }}>{p.name}</Link>
                        <span className="tiny muted">{p.clan_name || ""}</span>
                      </span>
                      {p.is_registered ? null : <span className="chip" style={{ height: 20 }}>бүртгэлгүй</span>}
                      {p.is_self ? <span className="chip pri" style={{ height: 20 }}>Та</span> : null}
                    </span>
                  </td>
                  <td>{p.is_registered ? <StatusChip st={stBy.get(p.status_id || "")} /> : <span className="muted">—</span>}</td>
                  <td>{p.ongodNames.join(", ") || <span className="muted">—</span>}</td>
                  <td>{p.supporters.join(", ") || "—"}</td>
                  <td className="num">{p.hidden.includes("huyag_on") ? <Locked /> : p.huyag_on || "—"}</td>
                  <td className="small">{p.hidden.includes("knowledge_level_id") ? <Locked /> : kBy.get(p.knowledge_level_id || "") || "—"}</td>
                  {noPhone ? null : <td className="num">{p.hidden.includes("phone") ? <Locked /> : p.phone || "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="show-m">
          {rows.map((p) => (
            <Link key={p.id} className="list-item" href={`/people/${p.id}`} style={{ color: "inherit", textDecoration: "none" }}>
              <Avatar name={p.name} st={stBy.get(p.status_id || "")} size={44} />
              <span className="col" style={{ flex: 1, minWidth: 0 }}>
                <b>{p.name}</b>
                <span className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.ongodNames.join(", ") || (p.is_registered ? "Онгод тодорхойгүй" : "Бүртгэлгүй")}</span>
              </span>
              {p.is_registered ? <Shape st={stBy.get(p.status_id || "")} s={18} /> : null}
            </Link>
          ))}
        </div>
        {rows.length ? null : <div style={{ padding: 16 }}><div className="empty"><b>Илэрц алга</b><span>Хайлт, шүүлтээ өөрчилж үзнэ үү.</span></div></div>}
      </div>
    </>
  );
}
