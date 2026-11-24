import { deleteOngod, saveOngod } from "@/app/actions/admin";
import { ConfirmButton } from "@/components/AutoSubmit";
import { Flash } from "@/components/Flash";
import { loadLookups, loadOngods, ongodPaths, type OngodNode } from "@/lib/data";
import { asViewer, requirePerm } from "@/lib/viewer";

export const metadata = { title: "Онгодын мод" };

export default async function OngodAdmin({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const v = await requirePerm("ongod.edit");
  const sp = await searchParams;
  const { ongods, lk, counts } = await asViewer(v, async (q) => ({
    ongods: await loadOngods(q),
    lk: await loadLookups(q),
    counts: new Map((await q<{ ongod_id: string; n: string }>("SELECT ongod_id, count(*) AS n FROM person_ongod GROUP BY ongod_id")).map((r) => [r.ongod_id, Number(r.n)])),
  }));
  const paths = ongodPaths(ongods);
  const kids = new Map<string, OngodNode[]>();
  for (const o of ongods) { const k = o.parent_id || ""; (kids.get(k) || kids.set(k, []).get(k)!).push(o); }
  const flat: { o: OngodNode; depth: number }[] = [];
  const walk = (pid: string, depth: number) => { if (depth > 40) return; for (const o of kids.get(pid) || []) { flat.push({ o, depth }); walk(o.id, depth + 1); } };
  walk("", 0);
  const eraBy = new Map(lk.eras.map((e) => [e.id, e.name]));
  const parentOpts = ongods.map((o) => <option key={o.id} value={o.id}>{paths.get(o.id)}</option>);
  const fields = (o?: OngodNode) => (
    <>
      <div className="formgrid">
        <label className="field">Нэр / алдар<input className="inp" name="name" required defaultValue={o?.name || ""} maxLength={160} /></label>
        <label className="field">Төрөл
          <select className="inp" name="kind" defaultValue={o?.kind || "ongod"}><option value="ongod">Онгод</option><option value="group">Бүлэг (хаан, цаг үе, ангилал)</option></select>
        </label>
        <label className="field">Дээд зангилаа
          <select className="inp" name="parent_id" defaultValue={o?.parent_id || ""}><option value="">(үндэс)</option>{parentOpts}</select>
        </label>
        <label className="field">Цаг үе
          <select className="inp" name="era_id" defaultValue={o?.era_id || ""}><option value="">(дээд зангилаанаас)</option>{lk.eras.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
        </label>
        <label className="field">Байр суурь, цол<input className="inp" name="title" defaultValue={o?.title || ""} maxLength={300} /></label>
        <label className="field">Эрэмбэ<input className="inp" type="number" name="sort" defaultValue={o?.sort ?? 0} /></label>
      </div>
      <label className="field">Намтар, тэмдэглэл<textarea className="inp" name="note" defaultValue={o?.note || ""} maxLength={4000} /></label>
    </>
  );
  const review = ongods.filter((o) => o.needs_review).length;
  return (
    <>
      <div className="pagehead"><div><div className="crumb">{v.urguu.name}</div><h1>Онгодын мод</h1></div><span className="small muted">{ongods.length} зангилаа</span></div>
      <Flash m={sp.m} />
      {review ? <div className="banner">{review} онгод хянагдаагүй байна (формоос эсвэл импортоос шинээр нэмэгдсэн). Дээд зангилааг нь сонгож хадгалбал хянагдсан болно.</div> : null}
      <details className="card inline">
        <summary className="row" style={{ fontWeight: 700, color: "var(--pri)" }}>+ Зангилаа нэмэх</summary>
        <form action={saveOngod} className="col g12" style={{ marginTop: 16 }}>{fields()}<div><button className="btn pri">Нэмэх</button></div></form>
      </details>
      <div className="card p0 tree-ed">
        {flat.map(({ o, depth }) => (
          <details key={o.id} className="inline">
            <summary className="trow" style={{ paddingLeft: 12 + depth * 22 }}>
              <span className={`chip ${o.kind === "group" ? "gold" : ""}`} style={{ height: 22 }}>{o.kind === "group" ? "Бүлэг" : "Онгод"}</span>
              <b style={{ fontWeight: o.kind === "group" ? 700 : 500 }}>{o.name}</b>
              {o.era_id ? <span className="tiny muted">{eraBy.get(o.era_id)}</span> : null}
              {o.title ? <span className="tiny muted">· {o.title}</span> : null}
              {counts.get(o.id) ? <span className="chip pri" style={{ height: 22 }}>{counts.get(o.id)} хүн</span> : null}
              {o.needs_review ? <span className="chip warn" style={{ height: 22 }}>хянах</span> : null}
              <span className="tiny" style={{ marginLeft: "auto", color: "var(--pri)", fontWeight: 600 }}>Засах</span>
            </summary>
            <div className="col g12" style={{ padding: "12px 16px 16px", background: "var(--bg)", borderBottom: "1px solid var(--line)" }}>
              <form action={saveOngod} className="col g12">
                <input type="hidden" name="id" value={o.id} />
                {fields(o)}
                <div className="row"><button className="btn pri sm">Хадгалах</button></div>
              </form>
              <form action={deleteOngod}><input type="hidden" name="id" value={o.id} /><ConfirmButton className="btn sm danger" message={`«${o.name}» зангилааг устгах уу?`}>Устгах</ConfirmButton></form>
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
