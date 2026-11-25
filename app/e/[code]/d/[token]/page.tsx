import Link from "next/link";
import { PayBox } from "@/components/PayBox";
import { Icon } from "@/components/ui";
import { hashToken } from "@/lib/codes";
import { sys } from "@/lib/db";
import { PAYMENT_STATE, type Payment } from "@/lib/payments";
import { money } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Хандив", robots: { index: false }, referrer: "no-referrer" as const };

/** Нэвтрээгүй хандивлагчийн нэхэмжлэх, төлөв (нууц холбоосоор). */
export default async function DonationStatus({ params, searchParams }: { params: Promise<{ code: string; token: string }>; searchParams: Promise<{ m?: string }> }) {
  const { code, token } = await params;
  const sp = await searchParams;
  const [p] = /^[\w-]{20,64}$/.test(token)
    ? await sys<Payment & { event_name: string }>("SELECT pm.*, e.name AS event_name FROM payment pm JOIN event e ON e.id = pm.event_id WHERE pm.access_hash = $1 AND e.public_code = $2", [hashToken(token), code])
    : [];
  if (!p) return <div className="pubwrap"><div className="card col g12"><h1>Хандив олдсонгүй</h1><Link className="btn" href={`/e/${code}`}>Буцах</Link></div></div>;
  return (
    <div className="pubwrap">
      <div className="brand" style={{ padding: 0 }}><span className="logo" style={{ color: "#fff" }}><Icon n="map" s={18} /></span>Хуягтан</div>
      {sp.m === "paid" ? <div className="banner ok" role="status">Хандив хүлээн авлаа. Баярлалаа!</div> : sp.m === "unpaid" ? <div className="banner info" role="status">Төлбөр хараахан орж ирээгүй байна. Төлсөн бол хэдэн минутын дараа дахин шалгана уу.</div> : null}
      <div className="card col g12">
        <h1>{p.event_name}</h1>
        <div className="row between"><span>Хандив</span><b className="num">{money(p.amount)}</b></div>
        <span className={`chip ${PAYMENT_STATE[p.state]?.[0] || ""}`} style={{ alignSelf: "flex-start" }}>{PAYMENT_STATE[p.state]?.[1]}</span>
        {p.state === "pending" ? <PayBox p={p} back={`/e/${code}/d/${token}`} /> : null}
        {p.state === "paid" ? <span className="muted">Таны хандивыг хүлээн авлаа. Энэ хуудсыг баримт болгон хадгалж болно.</span> : null}
      </div>
      <Link className="small" href={`/e/${code}`} style={{ textAlign: "center" }}>Дахин хандив өгөх</Link>
    </div>
  );
}
