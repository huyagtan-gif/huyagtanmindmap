import { createHash } from "node:crypto";
import Link from "next/link";
import { AuthFrame } from "@/components/AuthFrame";
import { acceptInvite, logout } from "@/app/actions/auth";
import { sys } from "@/lib/db";
import { getT, tMeta } from "@/lib/i18n";
import { getViewer } from "@/lib/viewer";

export const generateMetadata = tMeta("Урилга");
export const dynamic = "force-dynamic";

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const t = await getT();
  const hash = createHash("sha256").update(token).digest("hex");
  const [inv] = await sys<{ email: string; urguu: string; role: string; used_at: Date | null; expired: boolean }>(
    `SELECT i.email, u.name AS urguu, r.name AS role, i.used_at, i.expires_at < now() AS expired
     FROM invite i JOIN urguu u ON u.id = i.urguu_id JOIN role r ON r.id = i.role_id WHERE i.token_hash = $1`,
    [hash],
  );
  if (!inv || inv.used_at || inv.expired)
    return (
      <AuthFrame title={t("Урилга хүчингүй")} sub={t("Энэ урилга ашиглагдсан эсвэл хугацаа нь дууссан байна. Өргөөний админаас шинэ урилга хүснэ үү.")}>
        <Link className="btn" href="/login">{t("Нэвтрэх")}</Link>
      </AuthFrame>
    );
  const v = await getViewer();
  const next = `/invite/${token}`;
  if (!v)
    return (
      <AuthFrame title={t("{urguu} · урилга", { urguu: inv.urguu })} sub={t("Таныг «{role}» түвшнээр урьсан байна. Үргэлжлүүлэхийн тулд {email} хаягаар нэвтэрнэ үү.", { role: inv.role, email: inv.email })}>
        <Link className="btn pri lg" href={`/login?next=${encodeURIComponent(next)}&email=${encodeURIComponent(inv.email)}`}>{t("Нэвтэрч үргэлжлүүлэх")}</Link>
      </AuthFrame>
    );
  const match = v.email.toLowerCase() === inv.email.toLowerCase();
  return (
    <AuthFrame title={t("{urguu} · урилга", { urguu: inv.urguu })} sub={t("Таныг «{role}» түвшнээр урьсан байна.", { role: inv.role })}>
      {sp.e ? <div className="banner bad">{t("Урилгыг хүлээн авч чадсангүй.")}</div> : null}
      {match ? (
        <form action={acceptInvite}>
          <input type="hidden" name="token" value={token} />
          <button className="btn pri lg" style={{ width: "100%" }} type="submit">{t("Урилгыг хүлээн авах")}</button>
        </form>
      ) : (
        <>
          <div className="banner bad">{t("Урилга {invited} хаягт илгээгдсэн. Та {current} хаягаар нэвтэрсэн байна.", { invited: inv.email, current: v.email })}</div>
          <form action={logout}><button className="btn" style={{ width: "100%" }} type="submit">{t("Гараад өөр хаягаар нэвтрэх")}</button></form>
        </>
      )}
    </AuthFrame>
  );
}
