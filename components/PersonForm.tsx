import { MultiPicker, type Opt } from "./Pickers";
import { Locked } from "./ui";
import { savePerson } from "@/app/actions/person";
import { loadLookups, loadOngods, loadPeople, loadPerson, ongodPaths } from "@/lib/data";
import { displayName } from "@/lib/project";
import { asViewer, type Member } from "@/lib/viewer";

const HUYAG_TODAY = ["Өмнө нь хуягласан", "Тийм, өнөөдөр хуяглаж байна", "Үгүй"];

/** P1.6 / P1.7: бүртгэлийн форм (Google Form-ын 25 асуулт). Өөрийн болон (эрхтэй бол) бусдын мэдээллийг засна. */
export async function PersonForm({ viewer, personId, returnTo }: { viewer: Member; personId: string; returnTo: string }) {
  const data = await asViewer(viewer, async (q) => {
    const person = await loadPerson(q, viewer, personId);
    if (!person) return null;
    const [lk, ongods, people, po, pd, rels, questions, answers] = await Promise.all([
      loadLookups(q),
      loadOngods(q),
      loadPeople(q, viewer),
      q<{ ongod_id: string }>("SELECT ongod_id FROM person_ongod WHERE person_id = $1 ORDER BY is_primary DESC, sort", [personId]),
      q<{ deedes_id: string }>("SELECT deedes_id FROM person_deedes WHERE person_id = $1", [personId]),
      q<{ to_person_id: string; key: string }>(
        "SELECT r.to_person_id, t.key FROM relation r JOIN relation_type t ON t.id = r.type_id WHERE r.from_person_id = $1", [personId]),
      q<{ id: string; text: string; type: string; options: string[] | null; required: boolean }>(
        "SELECT id, text, type, options, required FROM form_question WHERE active AND urguu_id = app_urguu() ORDER BY sort, text"),
      q<{ question_id: string; value: string | null }>("SELECT question_id, value FROM form_answer WHERE person_id = $1", [personId]),
    ]);
    return { person, lk, ongods, people, po, pd, rels, questions, answers };
  });
  if (!data) return <div className="empty"><b>Хүн олдсонгүй</b></div>;
  const { person: p, lk, ongods, people, po, pd, rels, questions, answers } = data;
  const hid = new Set(p.hidden);
  const paths = ongodPaths(ongods);
  const ongodOpts: Opt[] = ongods.filter((o) => o.kind === "ongod").map((o) => ({ id: o.id, label: o.name, sub: paths.get(o.id) }));
  const peopleOpts: Opt[] = people.filter((x) => x.id !== p.id).map((x) => ({
    id: x.id, label: displayName(x), sub: [x.clan_name, x.is_registered ? null : "бүртгэлгүй"].filter(Boolean).join(" · "),
    search: [x.father_name, x.given_name].filter(Boolean).join(" "),
  }));
  const nameOf = new Map(people.map((x) => [x.id, displayName(x)]));
  const relInit = (key: string) => rels.filter((r) => r.key === key && nameOf.has(r.to_person_id)).map((r) => ({ id: r.to_person_id, label: nameOf.get(r.to_person_id)! }));
  const ongodInit = po.map((x) => ({ id: x.ongod_id, label: ongods.find((o) => o.id === x.ongod_id)?.name || "—" }));
  const dset = new Set(pd.map((x) => x.deedes_id));
  const ans = new Map(answers.map((a) => [a.question_id, a.value || ""]));
  const yn = (name: string, val: boolean | null | undefined) => (
    <div className="checks">
      {[["true", "Тийм"], ["false", "Үгүй"]].map(([v, l]) => (
        <label key={v}><input type="radio" name={name} value={v} defaultChecked={val === (v === "true")} />{l}</label>
      ))}
    </div>
  );
  const personNew = "Бүртгэлд байхгүй хүн. Нэрээр нь хадгална.";

  return (
    <form action={savePerson} className="col g16" style={{ maxWidth: 860 }}>
      <input type="hidden" name="person_id" value={p.id} />
      <input type="hidden" name="return_to" value={returnTo} />

      <section className="card col g16">
        <h2>Үндсэн мэдээлэл</h2>
        <div className="formgrid">
          <label className="field">Ургийн овог<input className="inp" name="clan_name" defaultValue={p.clan_name || ""} maxLength={80} /></label>
          <label className="field">Эцгийн нэр<input className="inp" name="father_name" defaultValue={p.father_name || ""} maxLength={80} /></label>
          <label className="field"><span>Өөрийн нэр <span className="req">*</span></span><input className="inp" name="given_name" required defaultValue={p.given_name} maxLength={80} /></label>
        </div>
        <div className="formgrid">
          <label className="field">Утас{hid.has("phone") ? <Locked /> : <input className="inp" name="phone" inputMode="tel" defaultValue={p.phone || ""} maxLength={24} />}</label>
          <label className="field">Имэйл{hid.has("email") ? <Locked /> : <input className="inp" name="email" type="email" defaultValue={p.email || ""} maxLength={254} />}</label>
          <label className="field">Фэйсбүүк хаяг{hid.has("facebook") ? <Locked /> : <input className="inp" name="facebook" defaultValue={p.facebook || ""} maxLength={300} placeholder="https://www.facebook.com/…" />}</label>
        </div>
      </section>

      <section className="card col g16">
        <h2>Онгод</h2>
        <div className="field">
          Эрэмбийн онгодын алдар
          <span className="hint">Өргөөний модноос хайж сонгоно. Олныг сонгож болно, эхнийх нь үндсэн онгод.</span>
          <MultiPicker name="ongod" options={ongodOpts} initial={ongodInit} placeholder="Онгодын нэрээр хайх" />
        </div>
        <details className="inline">
          <summary className="small" style={{ color: "var(--pri)", fontWeight: 600 }}>Модонд байхгүй юу? Шинээр нэмэх</summary>
          <div className="formgrid" style={{ marginTop: 12 }}>
            <label className="field">Онгодын алдар<input className="inp" name="ongod_new_name" maxLength={120} /></label>
            <label className="field">Цаг үе
              <select className="inp" name="ongod_new_era" defaultValue="">
                <option value="">Сонгох</option>
                {lk.eras.filter((e) => e.active).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label className="field">Байр суурь, цол<input className="inp" name="ongod_new_title" maxLength={200} /></label>
          </div>
          <span className="hint small muted">Админ хянаад модонд зөв байрлуулна.</span>
        </details>
        <div className="formgrid">
          <label className="field">Онгодын дууддаг нэр<input className="inp" name="ongod_nickname" defaultValue={p.ongod_nickname || ""} maxLength={120} /></label>
          <label className="field">Улаачийн тэнгэрийн алдар{hid.has("ulaach_name") ? <Locked /> : <input className="inp" name="ulaach_name" defaultValue={p.ulaach_name || ""} maxLength={120} />}</label>
        </div>
      </section>

      <section className="card col g16">
        <h2>Хуяг</h2>
        <div className="formgrid">
          <label className="field">Багштай золгосон огноо{hid.has("met_teacher_on") ? <Locked /> : <input className="inp" type="date" name="met_teacher_on" defaultValue={p.met_teacher_on || ""} />}</label>
          <label className="field">Хуяглуулсан огноо{hid.has("huyag_on") ? <Locked /> : <input className="inp" type="date" name="huyag_on" defaultValue={p.huyag_on || ""} />}</label>
          <label className="field">Хуягийн төрөл
            <select className="inp" name="huyag_type_id" defaultValue={p.huyag_type_id || ""}>
              <option value="">—</option>
              {lk.huyagTypes.filter((t) => t.active || t.id === p.huyag_type_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
        <div className="field">Хуягласан дээдэс
          <div className="checks">
            {lk.deedes.filter((d) => d.active || dset.has(d.id)).map((d) => (
              <label key={d.id}><input type="checkbox" name="deedes" value={d.id} defaultChecked={dset.has(d.id)} />{d.name}</label>
            ))}
          </div>
        </div>
        <label className="field">Хуягийн тэмдэглэл<input className="inp" name="huyag_note" defaultValue={p.huyag_note || ""} maxLength={300} placeholder="Жишээ: Эхээс төрөхдөө хуяглагдсан" /></label>
        <div className="field">Өнөөдөр хуяглаж байна уу?
          <div className="checks">
            {HUYAG_TODAY.map((o) => <label key={o}><input type="radio" name="huyag_today" value={o} defaultChecked={p.huyag_today === o} />{o}</label>)}
          </div>
        </div>
      </section>

      <section className="card col g16">
        <h2>Холбоо</h2>
        <div className="field">Багш<MultiPicker name="rel_teacher" options={peopleOpts} initial={relInit("teacher")} placeholder="Нэрээр хайх" allowNew newHint={personNew} /></div>
        <div className="field">Танилцуулсан хүн<MultiPicker name="rel_introducer" options={peopleOpts} initial={relInit("introducer")} placeholder="Нэрээр хайх" allowNew newHint={personNew} /></div>
        <div className="field">Түшсэн хүн<MultiPicker name="rel_supporter" options={peopleOpts} initial={relInit("supporter")} placeholder="Нэрээр хайх" allowNew newHint={personNew} /></div>
        <div className="field">Мэдээлэл авдаг хүн<MultiPicker name="rel_informant" options={peopleOpts} initial={relInit("informant")} placeholder="Нэрээр хайх" allowNew newHint={personNew} /></div>
        <label className="field">Мэдээлэл авдаг бусад эх сурвалж<input className="inp" name="info_source" defaultValue={p.info_source || ""} maxLength={300} placeholder="Жишээ: Подкастууд" /></label>
      </section>

      <section className="card col g16">
        <h2>Мэдлэг, оролцоо</h2>
        <label className="field">Мэдлэгийн түвшин
          {hid.has("knowledge_level_id") ? <Locked /> : (
            <select className="inp" name="knowledge_level_id" defaultValue={p.knowledge_level_id || ""}>
              <option value="">—</option>
              {lk.knowledge.filter((t) => t.active || t.id === p.knowledge_level_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
        </label>
        <div className="formgrid">
          <div className="field">Хээрийн сургалтад суусан уу?{yn("field_training", p.field_training)}</div>
          <div className="field">Судар уншдаг уу?{yn("sutra", p.sutra)}</div>
        </div>
        {hid.has("comment") ? null : <label className="field">Сэтгэгдэл<textarea className="inp" name="comment" defaultValue={p.comment || ""} maxLength={4000} /></label>}
        {hid.has("suggestion") ? null : <label className="field">Санал<textarea className="inp" name="suggestion" defaultValue={p.suggestion || ""} maxLength={4000} /></label>}
        {!p.is_self && !hid.has("teacher_note") ? (
          <label className="field">Багшийн тэмдэглэл<span className="hint">Зөвхөн эрх бүхий түвшин харна. Тухайн хүн өөрөө харахгүй.</span><textarea className="inp" name="teacher_note" defaultValue={p.teacher_note || ""} maxLength={4000} /></label>
        ) : null}
      </section>

      {questions.length ? (
        <section className="card col g16">
          <h2>{viewer.urguu.name} · нэмэлт асуулт</h2>
          {questions.map((qq) => {
            const nm = `q_${qq.id}`;
            const val = ans.get(qq.id) || "";
            return (
              <div className="field" key={qq.id}>
                <span>{qq.text}{qq.required ? <span className="req"> *</span> : null}</span>
                {qq.type === "longtext" ? <textarea className="inp" name={nm} defaultValue={val} required={qq.required} maxLength={4000} />
                  : qq.type === "date" ? <input className="inp" type="date" name={nm} defaultValue={val} required={qq.required} />
                  : qq.type === "yesno" || qq.type === "choice" ? (
                    <div className="checks">
                      {(qq.type === "yesno" ? ["Тийм", "Үгүй"] : qq.options || []).map((o) => (
                        <label key={o}><input type="radio" name={nm} value={o} defaultChecked={val === o} required={qq.required} />{o}</label>
                      ))}
                    </div>
                  ) : <input className="inp" name={nm} defaultValue={val} required={qq.required} maxLength={500} />}
              </div>
            );
          })}
        </section>
      ) : null}

      <div className="row wrap">
        <button className="btn pri lg" type="submit">Хадгалах</button>
        <span className="small muted">Хадгалахад шууд mind map-д тусаж, өөрчлөлтийн түүхэнд бүртгэгдэнэ.</span>
      </div>
    </form>
  );
}
