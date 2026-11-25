import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/AuthFrame";
import { loginSmsVerify } from "@/app/actions/auth";
import { smsMode } from "@/lib/sms";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "SMS кодоор нэвтрэх" };
export const dynamic = "force-dynamic";

const ERR: Record<string, string> = {
  code: "Код буруу эсвэл хугацаа нь дууссан байна. Дахин оролдоно уу.",
  rate: "Хэт олон оролдлого хийлээ. 15 минутын дараа дахин оролдоно уу.",
};

export default async function LoginSms({ searchParams }: { searchParams: Promise<{ phone?: string; next?: string; e?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/";
  if (await getViewer()) redirect(next);
  if (smsMode() === "off" || !sp.phone) redirect("/login");
  return (
    <AuthFrame title="Кодоо оруулна уу" sub={<>Хэрэв <b className="num">{sp.phone}</b> дугаар баталгаажсан гишүүнийх бол SMS-ээр 6 оронтой код очсон. Код 5 минут хүчинтэй.</>}>
      {sp.e ? <div className="banner bad" role="alert">{ERR[sp.e] || ERR.code}</div> : null}
      <form action={loginSmsVerify} className="col g12">
        <input type="hidden" name="next" value={next} />
        <input type="hidden" name="phone" value={sp.phone} />
        <label className="field">
          Код
          <input className="inp num" name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} placeholder="000000" autoFocus style={{ fontSize: 22, letterSpacing: ".3em", textAlign: "center" }} />
        </label>
        <button className="btn pri lg" type="submit">Нэвтрэх</button>
      </form>
      <span className="small muted">
        Код ирээгүй юу? Утсаа баталгаажуулаагүй бол <Link href="/login">имэйлийн холбоосоор</Link> нэвтэрч, «Миний мэдээлэл» хэсгээс баталгаажуулна уу.
      </span>
    </AuthFrame>
  );
}
