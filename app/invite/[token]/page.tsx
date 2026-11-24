import { createHash } from "node:crypto";
import Link from "next/link";
import { AuthFrame } from "@/components/AuthFrame";
import { acceptInvite, logout } from "@/app/actions/auth";
import { sys } from "@/lib/db";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Урилга" };
export const dynamic = "force-dynamic";

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const hash = createHash("sha256").update(token).digest("hex");
  const [inv] = await sys<{ email: string; urguu: string; role: string; used_at: Date | null; expired: boolean }>(
    `SELECT i.email, u.name AS urguu, r.name AS role, i.used_at, i.expires_at < now() AS expired
     FROM invite i JOIN urguu u ON u.id = i.urguu_id JOIN role r ON r.id = i.role_id WHERE i.token_hash = $1`,
    [hash],
  );
  if (!inv || inv.used_at || inv.expired)
    return (
      <AuthFrame title="Урилга хүчингүй" sub="Энэ урилга ашиглагдсан эсвэл хугацаа нь дууссан байна. Өргөөний админаас шинэ урилга хүснэ үү.">
        <Link className="btn" href="/login">Нэвтрэх</Link>
      </AuthFrame>
    );
  const v = await getViewer();
  const next = `/invite/${token}`;
  if (!v)
    return (
      <AuthFrame title={`${inv.urguu} · урилга`} sub={`Таныг «${inv.role}» түвшнээр урьсан байна. Үргэлжлүүлэхийн тулд ${inv.email} хаягаар нэвтэрнэ үү.`}>
        <Link className="btn pri lg" href={`/login?next=${encodeURIComponent(next)}&email=${encodeURIComponent(inv.email)}`}>Нэвтэрч үргэлжлүүлэх</Link>
      </AuthFrame>
    );
  const match = v.email.toLowerCase() === inv.email.toLowerCase();
  return (
    <AuthFrame title={`${inv.urguu} · урилга`} sub={`Таныг «${inv.role}» түвшнээр урьсан байна.`}>
      {sp.e ? <div className="banner bad">Урилгыг хүлээн авч чадсангүй.</div> : null}
      {match ? (
        <form action={acceptInvite}>
          <input type="hidden" name="token" value={token} />
          <button className="btn pri lg" style={{ width: "100%" }} type="submit">Урилгыг хүлээн авах</button>
        </form>
      ) : (
        <>
          <div className="banner bad">Урилга {inv.email} хаягт илгээгдсэн. Та {v.email} хаягаар нэвтэрсэн байна.</div>
          <form action={logout}><button className="btn" style={{ width: "100%" }} type="submit">Гараад өөр хаягаар нэвтрэх</button></form>
        </>
      )}
    </AuthFrame>
  );
}
