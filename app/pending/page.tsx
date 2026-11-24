import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/AuthFrame";
import { logout } from "@/app/actions/auth";
import { getViewer } from "@/lib/viewer";

export const metadata = { title: "Хүлээгдэж байна" };
export const dynamic = "force-dynamic";

export default async function Pending() {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (!v.personId) redirect("/register");
  if (v.membershipState === "approved") redirect("/");
  const rejected = v.membershipState === "rejected" || v.membershipState === "closed";
  return (
    <AuthFrame
      title={rejected ? "Хүсэлт батлагдаагүй" : "Хүлээгдэж байна"}
      sub={
        rejected
          ? "Таны бүртгэлийн хүсэлтийг өргөөний админ батлаагүй байна. Асуух зүйл байвал өргөөний админтай холбогдоно уу."
          : "Таны бүртгэлийн хүсэлтийг өргөөний админ хянаж байна. Батлагдмагц имэйлээр мэдэгдэнэ."
      }
    >
      <div className={`banner ${rejected ? "bad" : "info"}`}>
        <span>{v.email}</span>
        <span>{v.urguu?.name}</span>
      </div>
      <form action={logout}><button className="btn" type="submit" style={{ width: "100%" }}>Гарах</button></form>
    </AuthFrame>
  );
}
