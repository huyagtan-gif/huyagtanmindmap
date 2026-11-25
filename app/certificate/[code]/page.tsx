import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { Qr } from "@/components/Qr";
import { Icon } from "@/components/ui";
import { sys } from "@/lib/db";
import { SITE_URL } from "@/lib/mail";
import { displayName } from "@/lib/project";
import { ubDay } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Сертификат", robots: { index: false } };

/**
 * Phase 5: сургалт дүүргэсний сертификат. Кодтой хэн ч нээж (QR-аар) жинхэнэ эсэхийг шалгана.
 * Зөвхөн нэр, сургалт, огноо, өргөө харагдана: хувийн бусад мэдээлэл энд гарахгүй.
 */
export default async function Certificate({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [c] = /^[0-9a-f]{16}$/.test(code)
    ? await sys<{ certificate_no: string; certificate_at: Date; completion: string | null; father_name: string | null; given_name: string; clan_name: string | null; training: string; topic: string | null; training_id: string; urguu: string; first_at: Date | null; last_at: Date | null; hours: number }>(
        `SELECT tp.certificate_no, tp.certificate_at, tp.completion, p.father_name, p.given_name, p.clan_name, t.name AS training, t.topic, t.id AS training_id, u.name AS urguu,
           (SELECT min(starts_at) FROM training_session s WHERE s.training_id = t.id) AS first_at, (SELECT max(starts_at) FROM training_session s WHERE s.training_id = t.id) AS last_at,
           (SELECT count(*)::int FROM training_session s WHERE s.training_id = t.id) AS hours
         FROM training_participant tp JOIN person p ON p.id = tp.person_id JOIN training t ON t.id = tp.training_id JOIN urguu u ON u.id = t.urguu_id
         WHERE tp.certificate_code = $1`, [code])
    : [];
  if (!c)
    return <div className="pubwrap"><div className="card col g12"><h1>Сертификат олдсонгүй</h1><span className="muted">Certificate not found. Код буруу байна.</span><Link className="btn" href="/">Нүүр хуудас</Link></div></div>;
  const valid = c.completion === "completed";
  const teachers = await sys<{ father_name: string | null; given_name: string }>("SELECT p.father_name, p.given_name FROM training_teacher tt JOIN person p ON p.id = tt.person_id WHERE tt.training_id = $1 ORDER BY p.given_name", [c.training_id]);
  const name = [c.clan_name, displayName(c).replace(/^(\S)\./, "$1.")].filter(Boolean).join(" ");
  const period = c.first_at ? (c.last_at && ubDay(c.last_at) !== ubDay(c.first_at) ? `${ubDay(c.first_at)} – ${ubDay(c.last_at)}` : ubDay(c.first_at)) : ubDay(c.certificate_at);
  return (
    <div className="certwrap">
      <div className="row between noprint" style={{ width: "min(900px,100%)" }}>
        <span className={`chip ${valid ? "ok" : "bad"}`}>{valid ? "Баталгаат сертификат · Verified" : "Хүчингүй болсон · Revoked"}</span>
        <PrintButton />
      </div>
      <article className="cert" aria-label="Сертификат">
        <div className="brand" style={{ padding: 0, justifyContent: "center" }}><span className="logo" style={{ color: "#fff" }}><Icon n="map" s={18} /></span>Хуягтан · {c.urguu}</div>
        <div className="col g4" style={{ alignItems: "center" }}>
          <h1 className="cert-title">СЕРТИФИКАТ</h1>
          <span className="muted small" style={{ letterSpacing: ".2em" }}>CERTIFICATE OF COMPLETION</span>
        </div>
        <span className="muted">Энэхүү сертификатыг · This certifies that</span>
        <b className="cert-name">{name}</b>
        <span className="muted">дараах сургалтыг амжилттай дүүргэсэнийг гэрчилнэ · has completed</span>
        <b className="cert-course">{c.training}</b>
        {c.topic ? <span className="muted">{c.topic}</span> : null}
        <div className="row wrap" style={{ justifyContent: "center", gap: 24 }}>
          <span className="col" style={{ alignItems: "center" }}><span className="tiny muted">Хугацаа · Period</span><b className="num">{period}</b></span>
          <span className="col" style={{ alignItems: "center" }}><span className="tiny muted">Хичээл · Sessions</span><b className="num">{c.hours}</b></span>
          <span className="col" style={{ alignItems: "center" }}><span className="tiny muted">Дугаар · No.</span><b className="num">{c.certificate_no}</b></span>
        </div>
        <div className="row between" style={{ width: "100%", alignItems: "flex-end", marginTop: 16 }}>
          <div className="col g4" style={{ alignItems: "flex-start" }}>
            {teachers.length ? <><span className="cert-sign">{teachers.map(displayName).join(", ")}</span><span className="tiny muted">Багш · Teacher</span></> : null}
          </div>
          <div className="col g4" style={{ alignItems: "center", width: 112 }}>
            <Qr text={`${SITE_URL}/certificate/${code}`} />
            <span className="tiny muted">Шалгах · Verify</span>
          </div>
        </div>
      </article>
    </div>
  );
}
