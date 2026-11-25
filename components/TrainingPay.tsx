import type { Training } from "@/lib/training";
import type { Member } from "@/lib/viewer";

/** Оролцогчийн төлбөрийн хэсэг. Phase 4-т бөглөгдөнө. */
export async function TrainingPay(_: { trainingId: string; participantId: string; payState: string; fee: number; v: Member }) {
  return null;
}
/** Удирдагчийн «Төлбөр» таб. Phase 4-т бөглөгдөнө. */
export async function TrainingPayTab(_: { t: Training; v: Member }) {
  return null;
}
/** Зочны (нэвтрэлтгүй, нууц холбоосоор) төлбөрийн хэсэг. Phase 4-т бөглөгдөнө. */
export async function GuestPay(_: { code: string; token: string; participantId: string; payState: string; fee: number }) {
  return null;
}
