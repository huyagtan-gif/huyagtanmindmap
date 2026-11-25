import { qrSvg } from "@/lib/qr";

/** Серверт зурагдсан QR код. */
export function Qr({ text, size = 180 }: { text: string; size?: number }) {
  return <div className="qrbox" style={{ width: size, maxWidth: "100%", aspectRatio: "1", alignSelf: "center" }} dangerouslySetInnerHTML={{ __html: qrSvg(text) }} />;
}
