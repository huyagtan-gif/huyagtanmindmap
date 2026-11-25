import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/AuthFrame";
import { loginEmail, loginGoogle, loginSmsRequest } from "@/app/actions/auth";
import { Captcha } from "@/components/Captcha";
import { captchaSiteKey } from "@/lib/captcha";
import { smsMode } from "@/lib/sms";
import { googleEnabled } from "@/lib/auth";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Нэвтрэх" };
export const dynamic = "force-dynamic";

const ERR: Record<string, string> = {
  email: "Имэйл хаягаа зөв оруулна уу.",
  phone: "Утасны дугаараа зөв оруулна уу (8 орон).",
  captcha: "Робот биш гэдгээ баталгаажуулна уу.",
  rate: "Хэт олон оролдлого хийлээ. 15 минутын дараа дахин оролдоно уу.",
  Verification: "Холбоосын хугацаа дууссан эсвэл аль хэдийн ашиглагдсан байна. Шинээр холбоос авна уу.",
  OAuthAccountNotLinked: "Энэ имэйл өөр аргаар бүртгэгдсэн байна. Имэйлийн холбоосоор нэвтэрнэ үү.",
  default: "Нэвтрэхэд алдаа гарлаа. Дахин оролдоно уу.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string; error?: string; next?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/";
  if (await getViewer()) redirect(next);
  const code = sp.e || sp.error;
  const siteKey = captchaSiteKey();
  const sms = smsMode() !== "off";
  return (
    <AuthFrame title="Нэвтрэх" sub="Имэйл хаягаа оруулбал нэвтрэх холбоос илгээнэ. Нууц үг хэрэггүй.">
      {code ? <div className="banner bad" role="alert">{ERR[code] || ERR.default}</div> : null}
      <form action={loginEmail} className="col g12">
        <input type="hidden" name="next" value={next} />
        <label className="field">
          Имэйл
          <input className="inp" type="email" name="email" required autoComplete="email" inputMode="email" placeholder="ner@example.com" defaultValue={sp.email || ""} />
        </label>
        <Captcha siteKey={siteKey} />
        <button className="btn pri lg" type="submit">Холбоос авах</button>
      </form>
      {googleEnabled ? (
        <form action={loginGoogle}>
          <input type="hidden" name="next" value={next} />
          <button className="btn lg" style={{ width: "100%" }} type="submit">Google-ээр нэвтрэх</button>
        </form>
      ) : null}
      {sms ? (
        <form action={loginSmsRequest} className="col g12" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <input type="hidden" name="next" value={next} />
          <label className="field">
            Эсвэл утсаар
            <input className="inp" name="phone" required inputMode="tel" autoComplete="tel" placeholder="9911 2233" maxLength={20} />
            <span className="hint">Утсаа баталгаажуулсан гишүүнд SMS-ээр код очно.</span>
          </label>
          {siteKey ? <Captcha siteKey={siteKey} /> : null}
          <button className="btn lg" type="submit">SMS код авах</button>
        </form>
      ) : null}
      <span className="small muted">
        Шинэ хүн үү? <Link href="/register">Бүртгүүлэх</Link>
      </span>
    </AuthFrame>
  );
}
