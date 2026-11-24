import Link from "next/link";
import { AuthFrame } from "@/components/AuthFrame";

export const metadata = { title: "Имэйлээ шалгана уу" };

export default function Check() {
  return (
    <AuthFrame title="Имэйлээ шалгана уу" sub="Нэвтрэх холбоосыг таны имэйл рүү илгээлээ. Холбоос 30 минут хүчинтэй.">
      <div className="banner info">Имэйл ирээгүй бол Spam хавтсаа шалгаарай.</div>
      <Link className="btn" href="/login">Буцах</Link>
    </AuthFrame>
  );
}
