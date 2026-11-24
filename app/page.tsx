import { redirect } from "next/navigation";
import { getViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

export default async function Home() {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (!v.personId) redirect("/register");
  if (v.membershipState !== "approved") redirect("/pending");
  redirect(v.formCompleted ? "/map" : "/me");
}
