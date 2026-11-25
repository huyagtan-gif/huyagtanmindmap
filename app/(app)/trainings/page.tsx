import Link from "next/link";
import { Flash } from "@/components/Flash";
import { TrainingForm } from "@/components/TrainingForm";
import { Empty, Icon } from "@/components/ui";
import { peopleOptions } from "@/lib/events";
import { money, ubDay } from "@/lib/time";
import { P_STATE, SCOPE, T_STATE, type Training } from "@/lib/training";
import { asViewer, requireMember } from "@/lib/viewer";

export const metadata = { title: "Сургалт" };

type Row = Training & { reg: number; mine: string | null; first_at: Date | null; last_at: Date | null; n_sess: number; teachers: string | null; is_teacher: boolean };

export default async function Trainings({ searchParams }: { searchParams: Promise<{ add?: string; m?: string }> }) {
  const v = await requireMember();
  const sp = await searchParams;
  const can = v.perms.has("training.manage");
  const d = await asViewer(v, async (q) => ({
    rows: await q<Row>(
      `SELECT t.*,
         (SELECT count(*)::int FROM training_participant tp WHERE tp.training_id = t.id AND tp.state = 'yes') AS reg,
         (SELECT tp.state FROM training_participant tp WHERE tp.training_id = t.id AND tp.person_id = app_person()) AS mine,
         (SELECT min(s.starts_at) FROM training_session s WHERE s.training_id = t.id) AS first_at,
         (SELECT max(s.starts_at) FROM training_session s WHERE s.training_id = t.id) AS last_at,
         (SELECT count(*)::int FROM training_session s WHERE s.training_id = t.id) AS n_sess,
         (SELECT string_agg(coalesce(left(p.father_name, 1) || '.', '') || p.given_name, ', ' ORDER BY p.given_name)
            FROM training_teacher tt JOIN training_people(t.id) p ON p.person_id = tt.person_id WHERE tt.training_id = t.id) AS teachers,
         EXISTS (SELECT 1 FROM training_teacher tt WHERE tt.training_id = t.id AND tt.person_id = app_person()) AS is_teacher
       FROM training t ORDER BY coalesce((SELECT max(s.starts_at) FROM training_session s WHERE s.training_id = t.id), t.created_at) DESC LIMIT 200`),
    people: can && sp.add ? await peopleOptions(q, v) : null,
  }));
  const rows = d.rows.filter((t) => t.state !== "draft" || (t.urguu_id === v.urguu.id && (can || t.is_teacher)));
  return (
    <>
      <div className="pagehead">
        <div><div className="crumb">{v.urguu.name}</div><h1>Сургалт</h1></div>
        <div className="row wrap">
          <Link className="btn" href="/calendar"><Icon n="cal" s={16} /><span className="hide-m">Календарь</span></Link>
          {can ? <Link className="btn pri" href="/trainings?add=1"><Icon n="plus" s={16} w={2.4} />Сургалт нэмэх</Link> : null}
        </div>
      </div>
      <Flash m={sp.m} />
      {d.people ? <TrainingForm people={d.people} cancelHref="/trainings" /> : null}
      {rows.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 16 }}>
          {rows.map((t) => (
            <Link key={t.id} className="card col g12" href={`/trainings/${t.id}`} style={{ color: "inherit", textDecoration: "none" }}>
              <div className="row wrap" style={{ gap: 6 }}>
                <span className={`chip ${t.scope === "public" ? "pri" : ""}`}>{SCOPE[t.scope]}</span>
                {t.state !== "open" ? <span className={`chip ${T_STATE[t.state]?.[0] || ""}`}>{T_STATE[t.state]?.[1]}</span> : null}
                {t.mine ? <span className={`chip ${P_STATE[t.mine]?.[0] || ""}`}>{t.mine === "yes" ? "Та бүртгэлтэй" : t.mine === "invited" ? "Таныг урьсан" : P_STATE[t.mine]?.[1]}</span> : null}
                {t.urguu_id !== v.urguu.id ? <span className="chip gold">Хамтарсан</span> : null}
              </div>
              <h2>{t.name}</h2>
              <span className="small muted">{[t.topic, t.teachers ? `Багш: ${t.teachers}` : null].filter(Boolean).join(" · ") || "—"}</span>
              <div className="row between small">
                <span>{t.first_at ? `${ubDay(t.first_at)}${t.n_sess > 1 ? ` – ${ubDay(t.last_at!).slice(5)} · ${t.n_sess} хичээл` : ""}` : "Хуваарь тодорхойгүй"}</span>
                <b className="num">{t.fee ? money(t.fee) : "Үнэгүй"}</b>
              </div>
              <div className="col g4">
                {t.capacity ? <div className="bar"><span style={{ width: `${Math.min(100, Math.round((t.reg / t.capacity) * 100))}%` }} /></div> : null}
                <span className="tiny muted">{t.capacity ? `${t.reg} / ${t.capacity} бүртгэгдсэн` : `${t.reg} бүртгэгдсэн`}</span>
              </div>
            </Link>
          ))}
        </div>
      ) : <Empty title="Одоогоор сургалт алга">{can ? "Анхны сургалтаа нэмээд гишүүдээ урина уу." : "Сургалт зарлагдахад энд харагдана."}</Empty>}
    </>
  );
}
