import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { sys } from "./db";
import { SESSION_MAX_AGE, secureCookies } from "./auth";

/**
 * Auth.js-ийн database session-ийг гараар үүсгэнэ (SMS кодоор нэвтрэхэд).
 * Auth.js-ийн Credentials provider database session-тэй ажилладаггүй тул sessions хүснэгтэд мөр нэмж,
 * Auth.js-ийн хүлээдэг нэртэй cookie тавина. Дараагийн хүсэлтээс auth() үүнийг энгийн сешн гэж уншина.
 */
export async function createSession(userId: number) {
  const token = randomUUID();
  const expires = new Date(Date.now() + SESSION_MAX_AGE * 1000);
  await sys('INSERT INTO sessions ("userId", expires, "sessionToken") VALUES ($1,$2,$3)', [userId, expires, token]);
  (await cookies()).set(`${secureCookies ? "__Secure-" : ""}authjs.session-token`, token, {
    httpOnly: true, sameSite: "lax", path: "/", secure: secureCookies, expires,
  });
}
