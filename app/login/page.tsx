import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/AuthFrame";
import { loginEmail, loginGoogle, loginSmsRequest } from "@/app/actions/auth";
import { Captcha } from "@/components/Captcha";
import { captchaSiteKey } from "@/lib/captcha";
import { getT, N, tMeta } from "@/lib/i18n";
import { smsMode } from "@/lib/sms";
import { googleEnabled } from "@/lib/auth";
import { getViewer } from "@/lib/viewer";

export const generateMetadata = tMeta("Нэвтрэх");
export const dynamic = "force-dynamic";

const ERR: Record<string, string> = {
  email: N("Имэйл хаягаа зөв оруулна уу."),
  phone: N("Утасны дугаараа зөв оруулна уу (8 орон)."),
  captcha: N("Робот биш гэдгээ баталгаажуулна уу."),
  rate: N("Хэт олон оролдлого хийлээ. 15 минутын дараа дахин оролдоно уу."),
  Verification: N("Холбоосын хугацаа дууссан эсвэл аль хэдийн ашиглагдсан байна. Шинээр холбоос авна уу."),
  OAuthAccountNotLinked: N("Энэ имэйл өөр аргаар бүртгэгдсэн байна. Имэйлийн холбоосоор нэвтэрнэ үү."),
  default: N("Нэвтрэхэд алдаа гарлаа. Дахин оролдоно уу."),
};

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string; error?: string; next?: string; email?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/";
  if (await getViewer()) redirect(next);
  const t = await getT();
  const code = sp.e || sp.error;
  const siteKey = captchaSiteKey();
  const sms = smsMode() !== "off";
  return (
    <AuthFrame title={t("Нэвтрэх")} sub={t("Имэйл хаягаа оруулбал нэвтрэх холбоос илгээнэ. Нууц үг хэрэггүй.")}>
      {code ? <div className="banner bad" role="alert">{t(ERR[code] || ERR.default)}</div> : null}
      <form action={loginEmail} className="col g12">
        <input type="hidden" name="next" value={next} />
        <label className="field">
          {t("Имэйл")}
          <input className="inp" type="email" name="email" required autoComplete="email" inputMode="email" placeholder="ner@example.com" defaultValue={sp.email || ""} />
        </label>
        <Captcha siteKey={siteKey} />
        <button className="btn pri lg" type="submit">{t("Холбоос авах")}</button>
      </form>
      {googleEnabled ? (
        <form action={loginGoogle}>
          <input type="hidden" name="next" value={next} />
          <button className="btn lg" style={{ width: "100%" }} type="submit">{t("Google-ээр нэвтрэх")}</button>
        </form>
      ) : null}
      {sms ? (
        <form action={loginSmsRequest} className="col g12" style={{ borderTop: "1px solid var(--line)", paddingTop: 16 }}>
          <input type="hidden" name="next" value={next} />
          <label className="field">
            {t("Эсвэл утсаар")}
            <input className="inp" name="phone" required inputMode="tel" autoComplete="tel" placeholder="9911 2233" maxLength={20} />
            <span className="hint">{t("Утсаа баталгаажуулсан гишүүнд SMS-ээр код очно.")}</span>
          </label>
          {siteKey ? <Captcha siteKey={siteKey} /> : null}
          <button className="btn lg" type="submit">{t("SMS код авах")}</button>
        </form>
      ) : null}
      <span className="small muted">
        {t("Шинэ хүн үү?")} <Link href="/register">{t("Бүртгүүлэх")}</Link>
      </span>
    </AuthFrame>
  );
}
