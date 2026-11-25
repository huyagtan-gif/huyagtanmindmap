import Link from "next/link";
import { AuthFrame } from "@/components/AuthFrame";
import { getT, tMeta } from "@/lib/i18n";

export const generateMetadata = tMeta("Имэйлээ шалгана уу");

export default async function Check() {
  const t = await getT();
  return (
    <AuthFrame title={t("Имэйлээ шалгана уу")} sub={t("Нэвтрэх холбоосыг таны имэйл рүү илгээлээ. Холбоос 30 минут хүчинтэй.")}>
      <div className="banner info">{t("Имэйл ирээгүй бол Spam хавтсаа шалгаарай.")}</div>
      <Link className="btn" href="/login">{t("Буцах")}</Link>
    </AuthFrame>
  );
}
