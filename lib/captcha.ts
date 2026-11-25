// N6: нийтийн хуудсанд captcha (Cloudflare Turnstile, үнэгүй). TURNSTILE_SITE_KEY / TURNSTILE_SECRET_KEY
// тохируулаагүй бол captcha унтраалттай (rate limit хэвээр ажиллана).
export const captchaSiteKey = () => (process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY ? process.env.TURNSTILE_SITE_KEY : null);

export async function verifyCaptcha(fd: FormData, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !process.env.TURNSTILE_SITE_KEY) return true;
  const token = fd.get("cf-turnstile-response");
  if (typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip && ip !== "local") body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(8000) });
    const j = (await res.json()) as { success?: boolean };
    return !!j.success;
  } catch (e) {
    console.error("[captcha] шалгаж чадсангүй:", e instanceof Error ? e.message : e);
    return false;
  }
}
