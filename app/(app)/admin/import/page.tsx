import Link from "next/link";
import { importCsv, mergePeople, resolveIssue } from "@/app/actions/admin";
import { ConfirmButton } from "@/components/AutoSubmit";
import { Flash } from "@/components/Flash";
import { MultiPicker, type Opt } from "@/components/Pickers";
import { Empty } from "@/components/ui";
import { fmtDateTime } from "@/lib/audit-text";
import { loadOngods, loadPeople, ongodPaths } from "@/lib/data";
import { displayName } from "@/lib/project";
import { asViewer, requirePerm } from "@/lib/viewer";

export const metadata = { title: "Импорт, нэгтгэл" };

const KIND: Record<string, [string, string]> = {
  ongod_unmatched: ["Онгод тулгах", "warn"], person_merge_suggest: ["Нэр нэгтгэх санал", "pri"], date_warning: ["Огноо", "bad"],
  phone_format: ["Утас", "warn"], facebook_not_url: ["Фэйсбүүк", ""], self_reference: ["Өөрийгөө заасан", "warn"], status_guess: ["Төлөв", "warn"],
};

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ m?: string; all?: string }> }) {
  const v = await requirePerm("import.run", "person.merge");
  const sp = await searchParams;
  const canImport = v.perms.has("import.run");
  const canMerge = v.perms.has("person.merge");
  const d = await asViewer(v, async (q) => ({
    batches: await q<{ id: string; source: string; row_count: number; created_count: number; created_at: Date; open: string; total: string }>(
      `SELECT b.*, (SELECT count(*) FROM import_issue i WHERE i.batch_id = b.id AND i.resolved_at IS NULL) AS open,
              (SELECT count(*) FROM import_issue i WHERE i.batch_id = b.id) AS total FROM import_batch b ORDER BY b.created_at DESC`),
    issues: await q<{ id: string; kind: string; message: string; data: any; person_id: string | null; resolved_at: Date | null; resolution: string | null }>(
      `SELECT id, kind, message, data, person_id, resolved_at, resolution FROM import_issue ${sp.all ? "" : "WHERE resolved_at IS NULL"} ORDER BY resolved_at NULLS FIRST, kind, message LIMIT 500`),
    ongods: await loadOngods(q),
    people: await loadPeople(q, v),
  }));
  const paths = ongodPaths(d.ongods);
  const ongodOpts = d.ongods.filter((o) => o.kind === "ongod" && !o.needs_review);
  const open = d.issues.filter((i) => !i.resolved_at);
  const popts = (reg: boolean | null): Opt[] => d.people.filter((p) => reg === null || p.is_registered === reg).map((p) => ({
    id: p.id, label: displayName(p), sub: [p.clan_name, p.is_registered ? "бүртгэлтэй" : "бүртгэлгүй"].filter(Boolean).join(" · "), search: `${p.father_name || ""} ${p.given_name}`,
  }));
  return (
    <>
      <div className="pagehead"><div><div className="crumb">{v.urguu.name}</div><h1>Импорт, нэр нэгтгэл</h1></div></div>
      <Flash m={sp.m} />
      <div className="split">
        <div className="grow col g16">
          <div className="card p0">
            <div className="row between wrap" style={{ padding: "16px 16px 8px" }}>
              <h2>Хянах зүйлс · {open.length}</h2>
              <Link className="small" href={sp.all ? "/admin/import" : "/admin/import?all=1"}>{sp.all ? "Зөвхөн нээлттэйг харах" : "Шийдвэрлэснийг ч харах"}</Link>
            </div>
            {d.issues.length ? d.issues.map((is) => {
              const [kn, kc] = KIND[is.kind] || [is.kind, ""];
              return (
                <div key={is.id} className="col g12" style={{ padding: "12px 16px", borderBottom: "1px solid var(--sunk)", opacity: is.resolved_at ? 0.6 : 1 }}>
                  <div className="row wrap" style={{ alignItems: "flex-start" }}>
                    <span className={`chip ${kc}`} style={{ height: 22 }}>{kn}</span>
                    <span style={{ flex: "1 1 260px" }}>{is.message}</span>
                    {is.resolved_at ? <span className="chip ok" style={{ height: 22 }}>{is.resolution}</span> : null}
                  </div>
                  {is.resolved_at || !canImport ? null : (
                    <div className="row wrap">
                      {is.kind === "ongod_unmatched" ? (
                        <>
                          <form action={resolveIssue} className="row wrap">
                            <input type="hidden" name="id" value={is.id} /><input type="hidden" name="act" value="match" />
                            <select className="inp sm" name="ongod_id" required defaultValue="" style={{ width: "auto", maxWidth: 320 }} aria-label="Модны онгод">
                              <option value="" disabled>Модноос сонгох</option>
                              {ongodOpts.map((o) => <option key={o.id} value={o.id}>{paths.get(o.id)}</option>)}
                            </select>
                            <button className="btn sm pri">Энэ онгодтой холбох</button>
                          </form>
                          <form action={resolveIssue}><input type="hidden" name="id" value={is.id} /><button className="btn sm" name="act" value="keep">Шинэ зангилаа болгон үлдээх</button></form>
                        </>
                      ) : is.kind === "person_merge_suggest" ? (
                        <form action={resolveIssue} className="row wrap">
                          <input type="hidden" name="id" value={is.id} />
                          {canMerge ? <ConfirmButton className="btn sm pri" name="act" value="merge" message="Энэ хоёр бүртгэлийг нэг хүн болгон нэгтгэх үү? Буцаах боломжгүй.">Нэгтгэх</ConfirmButton> : null}
                          <button className="btn sm" name="act" value="ok">Өөр хүн</button>
                        </form>
                      ) : (
                        <form action={resolveIssue} className="row wrap">
                          <input type="hidden" name="id" value={is.id} />
                          <button className="btn sm" name="act" value="ok">Зөв</button>
                          {is.person_id ? <Link className="btn sm ghost" href={`/people/${is.person_id}/edit`}>Засах</Link> : null}
                        </form>
                      )}
                      {is.person_id && is.kind !== "date_warning" ? <Link className="btn sm ghost" href={`/people/${is.person_id}`}>Хүнийг харах</Link> : null}
                    </div>
                  )}
                </div>
              );
            }) : <div style={{ padding: 16 }}><Empty title="Хянах зүйл алга">Импортын бүх анхааруулга шийдвэрлэгдсэн.</Empty></div>}
          </div>
        </div>
        <div className="aside">
          {canImport ? (
            <form action={importCsv} className="card col g12">
              <h2>Google Sheet-ээс импортлох</h2>
              <span className="small muted">Google Sheet → File → Download → Comma Separated Values (.csv). Баганын дараалал Google Form-ынхтой ижил (A–Y) байх ёстой. Файл серверт хадгалагдахгүй, ижил файл хоёр удаа орохгүй.</span>
              <input className="inp" type="file" name="file" accept=".csv,text/csv" required style={{ padding: 10, height: "auto" }} />
              <button className="btn pri">Импортлох</button>
            </form>
          ) : null}
          {canMerge ? (
            <form action={mergePeople} className="card col g12">
              <h2>Нэр нэгтгэх</h2>
              <span className="small muted">Нэг хүн хоёр янзаар бичигдсэн бол (жишээ нь «Ganzo Bagsh») бүртгэлгүй нэрийг жинхэнэ бүртгэлд уусгана.</span>
              <div className="field">Уусгах (бүртгэлгүй нэр)<MultiPicker name="from_id" options={popts(false)} max={1} placeholder="Нэрээр хайх" /></div>
              <div className="field">Үлдэх хүн<MultiPicker name="into_id" options={popts(null)} max={1} placeholder="Нэрээр хайх" /></div>
              <ConfirmButton className="btn" message="Нэгтгэх үү? Буцаах боломжгүй.">Нэгтгэх</ConfirmButton>
            </form>
          ) : null}
          <div className="card p0">
            <div style={{ padding: "16px 16px 8px" }}><h2>Импортын түүх</h2></div>
            {d.batches.length ? d.batches.map((b) => (
              <div key={b.id} className="list-item">
                <div className="col" style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ overflowWrap: "anywhere" }}>{b.source}</b>
                  <span className="tiny muted">{fmtDateTime(b.created_at)} · {b.row_count} мөр · {b.created_count} шинэ</span>
                </div>
                <span className={`chip ${Number(b.open) ? "warn" : "ok"}`} style={{ height: 22 }}>{Number(b.open) ? `${b.open}/${b.total} нээлттэй` : "Бүгд шийдэгдсэн"}</span>
              </div>
            )) : <div style={{ padding: 16 }}><Empty title="Импорт хийгээгүй" /></div>}
          </div>
        </div>
      </div>
    </>
  );
}
