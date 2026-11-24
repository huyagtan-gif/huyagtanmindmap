// Нэр нормчлох, тулгах туслах функцууд (шаардлага §11.2, §11.3). Цэвэр функц — тесттэй.

const LATIN: [string, string][] = [
  ["shch", "щ"], ["sh", "ш"], ["ch", "ч"], ["kh", "х"], ["ts", "ц"], ["ya", "я"], ["yu", "ю"], ["yo", "ё"], ["ye", "е"],
  ["ii", "ий"], ["a", "а"], ["b", "б"], ["v", "в"], ["g", "г"], ["d", "д"], ["e", "э"], ["j", "ж"], ["z", "з"], ["i", "и"],
  ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"],
  ["f", "ф"], ["h", "х"], ["c", "ц"], ["y", "й"], ["w", "в"], ["q", "к"], ["x", "х"],
];

export function translit(s: string): string {
  let out = "";
  let i = 0;
  const low = s.toLowerCase();
  outer: while (i < low.length) {
    for (const [a, b] of LATIN) {
      if (low.startsWith(a, i)) {
        out += b;
        i += a.length;
        continue outer;
      }
    }
    out += low[i++];
  }
  return out;
}

const PERSON_SUFFIX = ["багш", "эмч", "удган", "найз", "бөө", "гуай", "ах", "эгч"];

/** Хүний нэрийн түлхүүр: жижиг үсэг, латин→кирилл, цол дагавар ба "Э." маягийн товчлол хасна, зай/цэг арилгана. */
export function normPerson(raw: string): string {
  let s = translit(raw.trim()).replace(/ё/g, "е").replace(/ү/g, "у").replace(/ө/g, "о");
  let words = s.split(/[\s.]+/).filter(Boolean);
  // "Э.Ганзориг" → эхний нэг үсэгтэй хэсгийг хасна
  if (words.length > 1 && words[0].length === 1) words = words.slice(1);
  words = words.filter((w) => !PERSON_SUFFIX.includes(w));
  return words.join("").replace(/[^a-zа-я0-9]/gi, "");
}

/** "Э.Ганзориг", "Болд Ганзориг" → { initial/эцгийн нэр, өөрийн нэр } */
export function splitName(raw: string): { father: string | null; given: string } {
  const t = raw.trim().replace(/\s+/g, " ");
  const m = t.match(/^(\S)\.\s*(.+)$/);
  if (m) return { father: m[1], given: m[2] };
  return { father: null, given: t };
}

const ONGOD_SUFFIX = ["дээдэс", "хаан", "хатан", "сэцэн", "эх"];

/** Онгодын нэрийн түлхүүр: "Хубилай Сэцэн Хаан Дээдэс" → "хубилай". */
export function normOngod(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[\s\-–.]+/)
    .filter(Boolean);
  const core = words.filter((w) => !ONGOD_SUFFIX.includes(w));
  return (core.length ? core : words).join("");
}

export function capFirst(s: string): string {
  const t = s.trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** Нэр бүрийн эхний үсгийг томоор ("хуримт түшээ" → "Хуримт Түшээ"). */
export function capWords(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Утас → E.164. 8 оронтой бол +976. Бусад тохиолдолд ok=false (анхааруулга). */
export function normPhone(raw: string): { value: string; ok: boolean } {
  const d = raw.replace(/[\s\-()]/g, "");
  if (!d) return { value: "", ok: true };
  if (/^\d{8}$/.test(d)) return { value: "+976" + d, ok: true };
  if (/^\+\d{8,15}$/.test(d)) return { value: d, ok: true };
  if (/^976\d{8}$/.test(d)) return { value: "+" + d, ok: true };
  return { value: raw.trim(), ok: false };
}

/** M/D/YYYY → YYYY-MM-DD (буруу бол null). */
export function parseUsDate(raw: string): string | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Ижил төстэй нэр эсэх: нэг нь нөгөөгийн эхлэл (≥4 үсэг), эсвэл засварын зай ≤ 2. */
export function similar(a: string, b: string): boolean {
  if (!a || !b || a === b) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (s.length >= 4 && l.startsWith(s)) return true;
  return s.length >= 5 && editDistance(a, b) <= 2;
}

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
