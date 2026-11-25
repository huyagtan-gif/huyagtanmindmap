import Link from "next/link";
import { redirect } from "next/navigation";
import { changeStatusForm } from "@/app/actions/person";
import { AutoSubmitSelect } from "@/components/AutoSubmit";
import { Avatar, Icon, Locked, Shape, StatusChip } from "@/components/ui";
import { fmtDateTime } from "@/lib/audit-text";
import { loadLookups, loadOngods, loadPeople, loadPerson, ongodEra, ongodPaths } from "@/lib/data";
import { displayName } from "@/lib/project";
import { asViewer, requireMember } from "@/lib/viewer";

export const metadata = { title: "Хүний карт" };

export default async function PersonCard({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; e?: string }> }) {
  const v = await requireMember();
  const { id } = await params;
  if (id !== v.personId && !v.perms.has("person.view")) redirect("/me");
  const sp = await searchParams;
  const d = await asViewer(v, async (q) => {
    const p = await loadPerson(q, v, id);
    if (!p) return null;
    const [lk, ongods, people, po, pd, rels, hist, aliases, answers] = await Promise.all([
      loadLookups(q), loadOngods(q), loadPeople(q, v),
      q<{ ongod_id: string }>("SELECT ongod_id FROM person_ongod WHERE person_id = $1 ORDER BY is_primary DESC, sort", [id]),
      q<{ deedes_id: string }>("SELECT deedes_id FROM person_deedes WHERE person_id = $1", [id]),
      q<{ from_person_id: string; to_person_id: string; key: string; type_name: string }>(
        `SELECT r.from_person_id, r.to_person_id, t.key, t.name AS type_name FROM relation r JOIN relation_type t ON t.id = r.type_id
         WHERE r.from_person_id = $1 OR r.to_person_id = $1 ORDER BY t.sort`, [id]),
      q<{ new_status_id: string | null; at: Date; by_father: string | null; by_given: string | null }>(
        `SELECT h.new_status_id, h.at, b.father_name AS by_father, b.given_name AS by_given FROM status_history h LEFT JOIN person b ON b.id = h.changed_by
         WHERE h.person_id = $1 ORDER BY h.at DESC, h.id DESC`, [id]),
      q<{ alias: string }>("SELECT alias FROM person_alias WHERE person_id = $1", [id]),
      q<{ text: string; value: string | null }>(
        "SELECT fq.text, fa.value FROM form_answer fa JOIN form_question fq ON fq.id = fa.question_id WHERE fa.person_id = $1 AND fq.active AND fa.value IS NOT NULL ORDER BY fq.sort", [id]),
    ]);
    return { p, lk, ongods, people, po, pd, rels, hist, aliases, answers };
  });
  if (!d) return <div className="empty"><b>Хүн олдсонгүй</b><Link href="/people">Хүмүүс рүү буцах</Link></div>;
  const { p, lk, ongods, people } = d;
  const hid = new Set(p.hidden);
  const stBy = new Map(lk.statuses.map((s) => [s.id, s]));
  const st = stBy.get(p.status_id || "");
  const paths = ongodPaths(ongods);
  const oBy = new Map(ongods.map((o) => [o.id, o]));
  const eBy = new Map(lk.eras.map((e) => [e.id, e.name]));
  const pBy = new Map(people.map((x) => [x.id, x]));
  const active = lk.statuses.filter((s) => s.active);
  const ci = active.findIndex((s) => s.id === p.status_id);
  const canEdit = p.is_self || v.perms.has("person.edit");
  const txt = (val: unknown) => (val ? String(val) : <span className="muted">—</span>);
  const gated = (key: string, val: unknown) => (hid.has(key) ? <Locked /> : txt(val));
  const yn = (b: boolean | null | undefined) => (b === true ? "Тийм" : b === false ? "Үгүй" : <span className="muted">—</span>);
  const myOngods = d.po.map((x) => oBy.get(x.ongod_id)).filter(Boolean) as typeof ongods;
  const deedes = d.pd.map((x) => lk.deedes.find((z) => z.id === x.deedes_id)?.name).filter(Boolean);
  const out = d.rels.filter((r) => r.from_person_id === id);
  const inc = d.rels.filter((r) => r.to_person_id === id);
  const OUT_LABEL: Record<string, string> = { teacher: "Багш", introducer: "Танилцуулсан", supporter: "Түшиж хуягласан", informant: "Мэдээлэл авдаг" };
  const IN_LABEL: Record<string, string> = { teacher: "Шавь", introducer: "Түүний танилцуулсан хүн", supporter: "Түүний түшсэн хүн", informant: "Түүнээс мэдээлэл авдаг" };
  const relRow = (label: string, otherId: string, key: string) => {
    const o = pBy.get(otherId);
    if (!o) return null;
    return (
      <div className="list-item" key={key}>
        <Avatar name={o.name} st={o.is_registered ? stBy.get(o.status_id || "") : null} size={40} />
        <span className="col" style={{ flex: 1 }}>
          <span className="tiny muted">{label}</span>
          <Link href={`/people/${o.id}`} style={{ fontWeight: 600 }}>{o.name}</Link>
          {o.is_registered ? null : <span className="tiny muted">Бүртгэлд алга</span>}
        </span>
      </div>
    );
  };
  const relRows = [
    ...out.map((r, i) => relRow(OUT_LABEL[r.key] || r.type_name, r.to_person_id, "o" + i)),
    ...inc.map((r, i) => relRow(IN_LABEL[r.key] || r.type_name, r.from_person_id, "i" + i)),
  ].filter(Boolean);
  const privHidden = hid.has("phone") && hid.has("email") && hid.has("facebook");
  const fb = p.facebook && /^https?:\/\//i.test(p.facebook) ? p.facebook : null;

  return (
    <>
      <Link href="/people" className="row small" style={{ gap: 4, fontWeight: 500 }}><Icon n="back" s={14} w={2.4} />Хүмүүс</Link>
      {sp.saved ? <div className="banner ok" role="status">Хадгалагдлаа.</div> : null}
      {sp.e ? <div className="banner bad" role="alert">{sp.e === "email" ? "Энэ имэйл хаяг өөр хүн дээр бүртгэлтэй байна. Бусад өөрчлөлт хадгалагдаагүй." : "Хадгалж чадсангүй."}</div> : null}
      <div className="card col g16" style={{ alignItems: "stretch" }}>
        <div className="row wrap g16" style={{ alignItems: "center" }}>
          <Avatar name={p.name} st={st} size={80} />
          <div className="col g4" style={{ flex: 1, minWidth: 200 }}>
            <div className="row wrap">
              <h1>{p.name}</h1>
              {p.is_self ? <span className="chip pri">Та</span> : null}
              {p.is_registered ? null : <span className="chip">бүртгэлгүй</span>}
            </div>
            <span className="small muted">{[p.clan_name, p.father_name && `${p.father_name}-ийн`, p.given_name].filter(Boolean).join(" · ")}</span>
            <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
              {p.is_registered ? <StatusChip st={st} /> : null}
              {p.huyag_on && !hid.has("huyag_on") ? <span className="chip">Хуягласан {p.huyag_on}</span> : null}
              {inc.some((r) => r.key === "teacher") ? <span className="chip">Багш</span> : null}
              {p.role_name ? <span className="chip gold">{p.role_name}</span> : null}
            </div>
          </div>
          <div className="row wrap">
            {v.perms.has("status.change") && p.is_registered ? (
              <form action={changeStatusForm}>
                <input type="hidden" name="person_id" value={id} />
                <input type="hidden" name="return_to" value={`/people/${id}`} />
                <label className="search" style={{ padding: "0 10px" }}>
                  <span className="small muted">Төлөв</span>
                  <AutoSubmitSelect name="status_id" defaultValue={p.status_id || ""} style={{ border: 0, background: "transparent", fontWeight: 600 }}>
                    {active.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </AutoSubmitSelect>
                </label>
              </form>
            ) : null}
            {canEdit ? <Link className="btn" href={p.is_self ? "/me" : `/people/${id}/edit`}><Icon n="edit" s={16} />Засах</Link> : null}
            {p.is_registered && v.perms.has("person.view") && v.views.has("ego") ? <Link className="btn soft" href={`/map?view=ego&ego=${id}`}>Төвд нь харах</Link> : null}
          </div>
        </div>
        {p.is_registered && ci >= 0 ? (
          <ol className="stepper" aria-label="Явцын шат">
            {active.map((s, i) => (
              <li key={s.id} className={i < ci ? "done" : i === ci ? "cur" : ""} aria-current={i === ci ? "step" : undefined}>
                <span className="c">{i <= ci ? <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3.5 8.2l3 3 6-6.4" /></svg> : null}</span>
                {s.name}
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <div className="split">
        <div className="grow col g16">
          <div className="card col g12">
            <h2>Эрэмбийн онгод</h2>
            <dl className="kv">
              <dt>Эрэмбийн онгод</dt>
              <dd>{myOngods.length ? myOngods.map((o) => <div key={o.id}><b>{o.name}</b><div className="tiny muted">{paths.get(o.id)}{o.title ? ` · ${o.title}` : ""}</div></div>) : <span className="muted">Тодорхойгүй</span>}</dd>
              <dt>Дууддаг нэр</dt><dd>{txt(p.ongod_nickname)}</dd>
              <dt>Цаг үе</dt><dd>{myOngods.length ? eBy.get(ongodEra(ongods, myOngods[0].id) || "") || "—" : "—"}</dd>
              <dt>Улаачийн алдар</dt><dd>{gated("ulaach_name", p.ulaach_name)}</dd>
            </dl>
          </div>
          <div className="card col g12">
            <h2>Хуяг</h2>
            <dl className="kv">
              <dt>Хуягласан дээдэс</dt><dd>{deedes.length ? deedes.map((n) => <span key={n} className="chip gold" style={{ marginRight: 6 }}>{n}</span>) : txt(p.huyag_note)}</dd>
              <dt>Багштай золгосон</dt><dd className="num">{gated("met_teacher_on", p.met_teacher_on)}</dd>
              <dt>Хуяглуулсан</dt><dd className="num">{gated("huyag_on", p.huyag_on)}</dd>
              <dt>Хуягийн төрөл</dt><dd>{txt(lk.huyagTypes.find((t) => t.id === p.huyag_type_id)?.name)}</dd>
              {deedes.length && p.huyag_note ? <><dt>Тэмдэглэл</dt><dd>{p.huyag_note}</dd></> : null}
              <dt>Мэдлэг</dt><dd>{gated("knowledge_level_id", lk.knowledge.find((t) => t.id === p.knowledge_level_id)?.name)}</dd>
              <dt>Хээрийн сургалт</dt><dd>{yn(p.field_training)}</dd>
              <dt>Судар</dt><dd>{yn(p.sutra)}</dd>
              <dt>Мэдээлэл авдаг</dt><dd>{txt(p.info_source)}</dd>
            </dl>
          </div>
          <div className="card col g12" style={privHidden ? undefined : { background: "#FBF7EF", borderColor: "#EBDDC0" }}>
            <div className="row between"><h2>Хувийн мэдээлэл</h2><span className="row tiny muted" style={{ gap: 4 }}><Icon n="lock" s={12} w={2.4} />{p.is_self ? "Таны мэдээлэл" : "Эрх бүхий түвшин л харна"}</span></div>
            <dl className="kv">
              <dt>Утас</dt><dd>{hid.has("phone") ? <Locked /> : p.phone ? <a className="num" href={`tel:${p.phone}`}>{p.phone}</a> : txt("")}</dd>
              <dt>Имэйл</dt><dd>{gated("email", p.email)}</dd>
              <dt>Фэйсбүүк</dt><dd>{hid.has("facebook") ? <Locked /> : fb ? <a href={fb} target="_blank" rel="noopener noreferrer nofollow">{fb}</a> : txt(p.facebook)}</dd>
            </dl>
          </div>
          <div className="card col g12">
            <h2>Сэтгэгдэл ба санал</h2>
            {hid.has("comment") && hid.has("suggestion") ? (
              <div className="row between small"><span className="muted">Эрх бүхий түвшин л харна</span><Locked /></div>
            ) : (
              <dl className="kv">
                <dt>Сэтгэгдэл</dt><dd style={{ whiteSpace: "pre-wrap" }}>{gated("comment", p.comment)}</dd>
                <dt>Санал</dt><dd style={{ whiteSpace: "pre-wrap" }}>{gated("suggestion", p.suggestion)}</dd>
                {!p.is_self && !hid.has("teacher_note") ? <><dt>Багшийн тэмдэглэл</dt><dd style={{ whiteSpace: "pre-wrap" }}>{txt(p.teacher_note)}</dd></> : null}
              </dl>
            )}
          </div>
          {d.answers.length ? (
            <div className="card col g12">
              <h2>Нэмэлт асуулт</h2>
              <dl className="kv">{d.answers.map((a, i) => <span key={i} style={{ display: "contents" }}><dt>{a.text}</dt><dd>{a.value}</dd></span>)}</dl>
            </div>
          ) : null}
        </div>
        <div className="aside">
          <div className="card p0">
            <div style={{ padding: "16px 16px 8px" }}><h2>Холбоо</h2></div>
            {relRows.length ? relRows : <div style={{ padding: 16 }}><div className="empty"><span className="small">Холбоо бүртгэгдээгүй</span></div></div>}
          </div>
          {p.is_registered ? (
            <div className="card col g12">
              <h2>Төлвийн түүх</h2>
              {d.hist.length ? (
                <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {d.hist.map((h, i) => (
                    <li key={i} className="row" style={{ alignItems: "flex-start", gap: 14 }}>
                      <span className="col" style={{ alignItems: "center", alignSelf: "stretch" }}>
                        <Shape st={stBy.get(h.new_status_id || "")} s={16} />
                        <span style={{ flex: 1, width: 2, background: i === d.hist.length - 1 ? "transparent" : "var(--line)", margin: "4px 0" }} />
                      </span>
                      <span className="col" style={{ paddingBottom: 18 }}>
                        <b>{stBy.get(h.new_status_id || "")?.name || "—"}</b>
                        <span className="small muted num">{fmtDateTime(h.at)} · {h.by_given ? displayName({ father_name: h.by_father, given_name: h.by_given }) : "Систем"}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              ) : <span className="small muted">Түүх алга</span>}
            </div>
          ) : null}
          {d.aliases.length > 2 || !p.is_registered ? (
            <div className="card col g12">
              <h2>Нэрийн хувилбар</h2>
              <div className="row wrap">{d.aliases.map((a) => <span key={a.alias} className="chip">{a.alias}</span>)}</div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
