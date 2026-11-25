// Серверийн талын хэл сонголт: `lang` cookie (LangSwitch тохируулна). Анхдагч нь монгол.
import { cookies } from "next/headers";
import { isLang, makeT, type Lang } from "./i18n-core";

export { LANGS, N, makeT, type Lang, type T } from "./i18n-core";

export async function getLang(): Promise<Lang> {
  try {
    const c = (await cookies()).get("lang")?.value;
    return isLang(c) ? c : "mn";
  } catch {
    return "mn";
  }
}
export const getT = async () => makeT(await getLang());

/** Нийтийн хуудасны орчуулсан гарчиг: `export const generateMetadata = tMeta("Нэвтрэх")`. */
export const tMeta = <E extends object>(title: string, extra?: E) => async () => ({ title: (await getT())(title), ...(extra || {}) });
