import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/AuthFrame";
import { register } from "@/app/actions/auth";
import { Captcha } from "@/components/Captcha";
import { captchaSiteKey } from "@/lib/captcha";
import { sys } from "@/lib/db";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Бүртгүүлэх" };
export const dynamic = "force-dynamic";

const ERR: Record<string, string> = {
  consent: "Үргэлжлүүлэхийн тулд хувийн мэдээлэл боловсруулахыг зөвшөөрнө үү.",
  name: "Өөрийн нэрээ оруулна уу.",
  phone: "Утасны дугаараа оруулна уу.",
  email: "Имэйл хаягаа зөв оруулна уу.",
  rate: "Хэт олон оролдлого хийлээ. 15 минутын дараа дахин оролдоно уу.",
  captcha: "Робот биш гэдгээ баталгаажуулна уу.",
};

export default async function Register({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const sp = await searchParams;
  const v = await getViewer();
  if (v?.personId) redirect("/");
  const urguus = await sys<{ id: string; name: string }>("SELECT id, name FROM urguu WHERE state = 'active' ORDER BY created_at");
  return (
    <AuthFrame wide title="Бүртгүүлэх" sub="Хүсэлтийг өргөөний админ баталсны дараа та бүртгэлийн формоо бөглөнө.">
      {sp.e ? <div className="banner bad" role="alert">{ERR[sp.e] || "Алдаа гарлаа."}</div> : null}
      <form action={register} className="col g16">
        <div className="formgrid">
          <label className="field">Эцгийн нэр<input className="inp" name="father_name" maxLength={80} autoComplete="additional-name" /></label>
          <label className="field"><span>Өөрийн нэр <span className="req">*</span></span><input className="inp" name="given_name" required maxLength={80} autoComplete="given-name" /></label>
        </div>
        <label className="field">Ургийн овог<input className="inp" name="clan_name" maxLength={80} /></label>
        {urguus.length > 1 ? (
          <label className="field">
            <span>Өргөө <span className="req">*</span></span>
            <select className="inp" name="urguu_id" required defaultValue={urguus[0].id}>{urguus.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <span className="hint">Элсэх хүсэлтийг энэ өргөөний админ батална.</span>
          </label>
        ) : null}
        <div className="formgrid">
          <label className="field"><span>Утас <span className="req">*</span></span><input className="inp" name="phone" required inputMode="tel" autoComplete="tel" placeholder="9911 2233" maxLength={20} /></label>
          <label className="field">
            <span>Имэйл <span className="req">*</span></span>
            {v ? <input className="inp" value={v.email} readOnly disabled /> : <input className="inp" type="email" name="email" required autoComplete="email" />}
            {v ? null : <span className="hint">Энэ хаягаар баталгаажуулах холбоос очно.</span>}
          </label>
        </div>
        <label className="row small" style={{ gap: 10, alignItems: "flex-start" }}>
          <input type="checkbox" name="consent" required style={{ width: 18, height: 18, marginTop: 2, accentColor: "var(--pri)" }} />
          <span>
            Миний хувийн мэдээллийг <Link href="/privacy" target="_blank">Нууцлалын бодлого</Link>-ын дагуу цуглуулж, боловсруулахыг зөвшөөрч байна.
          </span>
        </label>
        <Captcha siteKey={captchaSiteKey()} />
        <button className="btn pri lg" type="submit">Хүсэлт илгээх</button>
      </form>
      {v ? null : <span className="small muted">Бүртгэлтэй юу? <Link href="/login">Нэвтрэх</Link></span>}
    </AuthFrame>
  );
}
