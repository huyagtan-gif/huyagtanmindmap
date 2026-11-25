import qrcode from "qrcode-generator";

/** Текстийг QR код (SVG) болгоно. Гаднын үйлчилгээ ашиглахгүй: холбоос серверээс гарахгүй. */
export function qrSvg(text: string, opts: { margin?: number; ecc?: "L" | "M" | "Q" | "H" } = {}): string {
  const qr = qrcode(0, opts.ecc || "M");
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = opts.margin ?? 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      let w = 1;
      while (c + w < n && qr.isDark(r, c + w)) w++;
      d += `M${c + m} ${r + m}h${w}v1h-${w}z`;
      c += w;
    }
  }
  const s = n + m * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges" role="img" aria-label="QR код"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
