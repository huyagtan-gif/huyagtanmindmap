import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import PostgresAdapter from "@auth/pg-adapter";
import { pool } from "./db";
import { sendMail, SITE_URL } from "./mail";

export const SESSION_MAX_AGE = 30 * 24 * 3600;
/** Cookie-ний нэр (__Secure- угтвар) lib/session.ts-тэй таарах ёстой тул тодорхой зааж өгнө. */
export const secureCookies = SITE_URL.startsWith("https://");

const providers: any[] = [
  Nodemailer({
    // Жинхэнэ илгээлт lib/mail.ts-ээр (EMAIL_SERVER); энэ утга зөвхөн provider-ийн шаардлагыг хангана.
    server: process.env.EMAIL_SERVER || "smtp://localhost:25",
    from: process.env.EMAIL_FROM || "no-reply@huyagtan.mn",
    maxAge: 30 * 60,
    normalizeIdentifier: (id: string) => id.trim().toLowerCase(),
    async sendVerificationRequest({ identifier, url }: { identifier: string; url: string }) {
      const ok = await sendMail({
        to: identifier,
        template: "magic_link",
        subject: "Хуягтан: нэвтрэх холбоос",
        title: "Нэвтрэх холбоос",
        body: "Доорх товчийг дарж Хуягтан системд нэвтэрнэ үү. Холбоос 30 минут хүчинтэй, нэг удаа ашиглагдана. Хэрэв та хүсээгүй бол энэ имэйлийг үл тоомсорлоно уу.",
        cta: { label: "Нэвтрэх", url },
      }, { transient: true });
      if (!ok) throw new Error("Имэйл илгээж чадсангүй");
    },
  }),
];
if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  // Google имэйлийг баталгаажуулсан байдаг тул ижил имэйлтэй бүртгэлтэй холбохыг зөвшөөрнө.
  providers.push(Google({ allowDangerousEmailAccountLinking: true }));
}
export const googleEnabled = providers.length > 1;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool),
  session: { strategy: "database", maxAge: SESSION_MAX_AGE },
  trustHost: true,
  useSecureCookies: secureCookies,
  providers,
  pages: { signIn: "/login", verifyRequest: "/login/check", error: "/login" },
  callbacks: {
    session({ session, user }) {
      (session as any).userId = Number(user.id);
      return session;
    },
  },
});
