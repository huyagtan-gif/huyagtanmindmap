import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/AuthFrame";
import { logout } from "@/app/actions/auth";
import { getT, tMeta } from "@/lib/i18n";
import { getViewer } from "@/lib/viewer";

export const generateMetadata = tMeta("Хүлээгдэж байна");
export const dynamic = "force-dynamic";

export default async function Pending() {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (!v.personId) redirect("/register");
  if (v.membershipState === "approved") redirect("/");
  const t = await getT();
  const rejected = v.membershipState === "rejected" || v.membershipState === "closed";
  return (
    <AuthFrame
      title={rejected ? t("Хүсэлт батлагдаагүй") : t("Хүлээгдэж байна")}
      sub={
        rejected
          ? t("Таны бүртгэлийн хүсэлтийг өргөөний админ батлаагүй байна. Асуух зүйл байвал өргөөний админтай холбогдоно уу.")
          : t("Таны бүртгэлийн хүсэлтийг өргөөний админ хянаж байна. Батлагдмагц имэйлээр мэдэгдэнэ.")
      }
    >
      <div className={`banner ${rejected ? "bad" : "info"}`}>
        <span>{v.email}</span>
        <span>{v.urguu?.name}</span>
      </div>
      <form action={logout}><button className="btn" type="submit" style={{ width: "100%" }}>{t("Гарах")}</button></form>
    </AuthFrame>
  );
}
