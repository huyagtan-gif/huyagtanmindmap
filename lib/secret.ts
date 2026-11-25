import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// P4.1: төлбөрийн нууц түлхүүрийг DB-д шифрлэж хадгална (AES-256-GCM).
// Түлхүүр: PAYMENT_SECRET (байхгүй бол AUTH_SECRET)-ээс HKDF-ээр гаргана. Сервер дээрх .env-гүйгээр DB-ийн хуулбараас тайлагдахгүй.
const key = () => {
  const base = process.env.PAYMENT_SECRET || process.env.AUTH_SECRET;
  if (!base) throw new Error("PAYMENT_SECRET / AUTH_SECRET тохируулаагүй");
  return Buffer.from(hkdfSync("sha256", base, "huyagtan-payment", "qpay-config-v1", 32));
};

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}

export function decrypt(sealed: string): string {
  const [v, iv, tag, enc] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || !enc) throw new Error("Шифрийн хэлбэр буруу");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}
