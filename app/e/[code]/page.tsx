import Link from "next/link";
import { donatePublic } from "@/app/actions/pay";
import { Captcha } from "@/components/Captcha";
import { PubFooter } from "@/components/AuthFrame";
import { Icon } from "@/components/ui";
import { captchaSiteKey } from "@/lib/captcha";
import { sys } from "@/lib/db";
import { getT, N, tMeta } from "@/lib/i18n";
import { paymentsEnabled } from "@/lib/qpay";
import { fmtDay, fmtRange } from "@/lib/time";

export const dynamic = "force-dynamic";
export const generateMetadata = tMeta("Хандив");

const ERR: Record<string, string> = {
  amount: N("Дүнг 100₮-өөс дээш бүхэл тоогоор оруулна уу."), rate: N("Хэт олон оролдлого. Түр хүлээнэ үү."),
  captcha: N("Робот биш гэдгээ баталгаажуулна уу."), payerr: N("QPay нэхэмжлэх үүсгэж чадсангүй. Дараа дахин оролдоно уу."),
};

/** P4.4: үйлийн нийтийн хандивын хуудас (гишүүн бус хүн ч өгнө). Зөвхөн хандив нээлттэй үйлд. */
export default async function PublicEvent({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ e?: string }> }) {
  const { code } = await params;
  const sp = await searchParams;
  const tr = await getT();
  const [e] = /^[a-z0-9]{6,20}$/.test(code)
    ? await sys<{ id: string; urguu_id: string; name: string; starts_at: Date; ends_at: Date | null; place: string | null; description: string | null; state: string; urguu_name: string }>(
        `SELECT e.id, e.urguu_id, e.name, e.starts_at, e.ends_at, e.place, e.description, e.state, u.name AS urguu_name FROM event e JOIN urguu u ON u.id = e.urguu_id
         WHERE e.public_code = $1 AND e.donations_open AND e.state <> 'cancelled'`, [code])
    : [];
  if (!e) return <div className="pubwrap"><div className="card col g12"><h1>{tr("Хуудас олдсонгүй")}</h1><Link className="btn" href="/">{tr("Нүүр хуудас")}</Link></div></div>;
  const on = await paymentsEnabled(e.urguu_id);
  return (
    <div className="pubwrap">
      <div className="brand" style={{ padding: 0 }}><span className="logo" style={{ color: "#fff" }}><Icon n="map" s={18} /></span>{tr("Хуягтан")}<span className="small muted" style={{ fontWeight: 500, marginLeft: 8 }}>{e.urguu_name}</span></div>
      <div className="card col g12">
        <h1>{e.name}</h1>
        <span className="muted">{fmtDay(e.starts_at, tr.lang)} · {fmtRange(e.starts_at, e.ends_at).slice(11)}{e.place ? ` · ${e.place}` : ""}</span>
        {e.description ? <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{e.description}</p> : null}
      </div>
      <div className="card col g16">
        <h2>{tr("Хандив өргөх")}</h2>
        {sp.e ? <div className="banner bad" role="alert">{tr(ERR[sp.e] || "Алдаа гарлаа.")}</div> : null}
        {on ? (
          <form action={donatePublic} className="col g12">
            <input type="hidden" name="code" value={code} />
            <label className="field"><span>{tr("Дүн (₮)")} <span className="req">*</span></span><input className="inp" name="amount" inputMode="numeric" required placeholder="10000" maxLength={12} /></label>
            <label className="field">{tr("Таны нэр")}<span className="hint">{tr("Заавал биш")}</span><input className="inp" name="payer_name" maxLength={80} autoComplete="name" /></label>
            <label className="field">{tr("Ерөөл, үг")}<span className="hint">{tr("Заавал биш")}</span><input className="inp" name="message" maxLength={300} /></label>
            <label className="row small" style={{ gap: 8 }}><input type="checkbox" name="anonymous" />{tr("Нэрээ нууцлах (жагсаалтад «Нэрээ нууцалсан» гэж харагдана)")}</label>
            <Captcha siteKey={captchaSiteKey()} />
            <button className="btn pri lg">{tr("QPay-ээр хандив өгөх")}</button>
          </form>
        ) : <span className="muted">{tr("Одоогоор онлайнаар хандив хүлээн авахгүй байна.")}</span>}
      </div>
      <PubFooter lang={tr.lang} privacy={tr("Нууцлалын бодлого")} />
    </div>
  );
}
