import Link from "next/link";
import { redirect } from "next/navigation";
import { PersonForm } from "@/components/PersonForm";
import { Icon } from "@/components/ui";
import { requireMember } from "@/lib/viewer";

export const metadata = { title: "Мэдээлэл засах" };

export default async function EditPerson({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ e?: string }> }) {
  const v = await requireMember();
  const { id } = await params;
  const sp = await searchParams;
  if (id === v.personId) redirect("/me");
  if (!v.perms.has("person.edit")) redirect(`/people/${id}`);
  return (
    <>
      <Link href={`/people/${id}`} className="row small" style={{ gap: 4, fontWeight: 500 }}><Icon n="back" s={14} w={2.4} />Профайл</Link>
      <div className="pagehead"><h1>Мэдээлэл засах</h1></div>
      {sp.e ? <div className="banner bad" role="alert">{sp.e === "email" ? "Энэ имэйл хаяг өөр хүн дээр бүртгэлтэй байна." : "Хадгалж чадсангүй. Дахин оролдоно уу."}</div> : null}
      <PersonForm viewer={v} personId={id} returnTo={`/people/${id}`} />
    </>
  );
}
