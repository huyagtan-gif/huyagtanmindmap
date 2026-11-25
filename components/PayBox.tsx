import { checkPayment } from "@/app/actions/pay";
import { ActBtn } from "@/components/ActBtn";
import { Qr } from "@/components/Qr";
import type { Payment } from "@/lib/payments";
import { money } from "@/lib/time";

/** QPay нэхэмжлэх: QR, банкны аппын холбоосууд, «Төлбөрөө шалгах». */
export function PayBox({ p, back }: { p: Payment; back: string }) {
  const links = (p.deeplinks || []).filter((l) => /^(https?:|[a-z][a-z0-9+.-]*:|\/)/i.test(l.link));
  return (
    <div className="col g12" id="pay">
      <div className="row between"><b>QPay-ээр төлөх</b><b className="num">{money(p.amount)}</b></div>
      {p.qr_text ? <div style={{ maxWidth: 240, alignSelf: "center", width: "100%" }}><Qr text={p.qr_text} /></div> : null}
      <span className="small muted">Банкны аппаараа QR-ыг уншуулах эсвэл утаснаасаа доорх аппын аль нэгийг сонгоно уу. Төлсний дараа автоматаар баталгаажна.</span>
      {links.length ? (
        <details>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>Банкны апп сонгох ({links.length})</summary>
          <div className="row wrap" style={{ gap: 6, paddingTop: 8 }}>
            {links.map((l) => <a key={l.name + l.link} className="btn sm" href={l.link} rel="noopener noreferrer">{l.description || l.name}</a>)}
          </div>
        </details>
      ) : null}
      {p.short_url ? <a className="small" href={p.short_url} target="_blank" rel="noopener noreferrer">QPay хуудсаар нээх</a> : null}
      <ActBtn action={checkPayment} fields={{ payment_id: p.id, back }} className="btn">Төлбөрөө шалгах</ActBtn>
    </div>
  );
}
