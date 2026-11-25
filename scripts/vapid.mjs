// Web Push-ийн VAPID түлхүүр үүсгэнэ: `node scripts/vapid.mjs` → .env-д хуулна. Нэг удаа үүсгээд солихгүй
// (солибол бүх төхөөрөмж мэдэгдлээ дахин асаах шаардлагатай).
import { generateKeyPairSync } from "node:crypto";
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = privateKey.export({ format: "jwk" });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
void publicKey;
console.log(`VAPID_PUBLIC_KEY=${pub.toString("base64url")}\nVAPID_PRIVATE_KEY=${jwk.d}`);
