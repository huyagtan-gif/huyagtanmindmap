// P2.6: mind map-ийг PNG / PDF болгон татах (хөтөч дээр, серверт юу ч илгээхгүй).
// Дэлгэц дээрх яг тэр байрлал, өнгөөр canvas-д дахин зурна; PDF нь уг зургийг нэг хуудсанд агуулна.
export type XNode = {
  x: number; y: number; w: number; h: number; label: string;
  kind: "root" | "k" | "g" | "o" | "e" | "p"; big?: boolean; dashed?: boolean; border?: string; ink?: string;
  avatar?: { text: string; bg: string; ink: string }; cnt?: number;
};
export type XEdge = { x1: number; y1: number; x2: number; y2: number; hot?: boolean };

const FONT = "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif";

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function renderMap(nodes: XNode[], edges: XEdge[], W: number, H: number, title: string): HTMLCanvasElement {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  const C = {
    pri: v("--pri", "#1E4FA0"), ink: v("--ink", "#121B2A"), ink2: v("--ink2", "#3B4657"), muted: v("--muted", "#5A6576"), line: v("--line", "#DCE2EA"),
    goldS: v("--gold-s", "#FBF3E0"), goldL: v("--gold-l", "#EBDDC0"), goldInk: v("--gold-ink", "#7E4A05"), empty: v("--empty", "#8A94A3"),
  };
  // Хөтчийн canvas-ийн хязгаарт багтаана (тал бүр ≤ 16000px, талбай ≤ ~100 сая px). Жижиг модыг 2x нягтралтай зурна.
  const s = Math.min(2, 16000 / W, 16000 / H, Math.sqrt(100e6 / (W * H)));
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.floor(W * s));
  cv.height = Math.max(1, Math.floor(H * s));
  const c = cv.getContext("2d")!;
  c.scale(s, s);
  c.fillStyle = "#fff";
  c.fillRect(0, 0, W, H);
  c.textBaseline = "middle";
  c.fillStyle = C.ink;
  c.font = `700 16px ${FONT}`;
  c.fillText(title, 24, 26);

  for (const hot of [false, true]) {
    c.beginPath();
    for (const e of edges) {
      if (!!e.hot !== hot) continue;
      const mx = (e.x1 + e.x2) / 2;
      c.moveTo(e.x1, e.y1);
      c.bezierCurveTo(mx, e.y1, mx, e.y2, e.x2, e.y2);
    }
    c.strokeStyle = hot ? C.pri : "#C3CCD8";
    c.lineWidth = hot ? 2.5 : 1.5;
    c.stroke();
  }

  for (const n of nodes) {
    const st =
      n.kind === "root" ? { bg: C.pri, bd: C.pri, ink: "#fff", px: 15, wt: 700, r: 12, pad: 16 }
      : n.kind === "k" ? { bg: C.ink, bd: C.ink, ink: "#fff", px: 14, wt: 700, r: 10, pad: 12 }
      : n.kind === "g" ? { bg: C.goldS, bd: C.goldL, ink: C.goldInk, px: 13, wt: 600, r: 10, pad: 12 }
      : n.kind === "e" ? { bg: "#fff", bd: C.empty, ink: C.muted, px: 13, wt: 500, r: 10, pad: 12 }
      : n.kind === "p" ? { bg: "#fff", bd: n.border || C.line, ink: n.ink || C.ink, px: n.big ? 15 : 13, wt: n.big ? 700 : 600, r: 999, pad: 5 }
      : { bg: "#fff", bd: C.line, ink: C.ink, px: 13, wt: 500, r: 10, pad: 12 };
    rr(c, n.x, n.y, n.w, n.h, st.r);
    c.fillStyle = st.bg;
    c.fill();
    c.setLineDash(n.kind === "e" || n.dashed ? [4, 3] : []);
    c.lineWidth = n.kind === "p" ? (n.big ? 2 : 1.5) : 1;
    c.strokeStyle = st.bd;
    c.stroke();
    c.setLineDash([]);
    let tx = n.x + st.pad;
    const cy = n.y + n.h / 2;
    if (n.avatar) {
      const d = n.big ? 32 : 24;
      c.beginPath();
      c.arc(tx + d / 2, cy, d / 2, 0, Math.PI * 2);
      c.fillStyle = n.avatar.bg;
      c.fill();
      c.fillStyle = n.avatar.ink;
      c.font = `700 ${Math.round(d * 0.38)}px ${FONT}`;
      c.textAlign = "center";
      c.fillText(n.avatar.text.toUpperCase(), tx + d / 2, cy + 0.5);
      c.textAlign = "left";
      tx += d + 8;
    }
    c.fillStyle = st.ink;
    c.font = `${st.wt} ${st.px}px ${FONT}`;
    c.fillText(n.label, tx, cy + 0.5);
    if (n.cnt) {
      const t = String(n.cnt);
      c.font = `700 11px ${FONT}`;
      const cw = Math.max(20, c.measureText(t).width + 12);
      rr(c, n.x + n.w - 12 - cw, cy - 10, cw, 20, 10);
      c.fillStyle = n.kind === "g" ? C.goldL : "rgba(255,255,255,.2)";
      c.fill();
      c.fillStyle = st.ink;
      c.textAlign = "center";
      c.fillText(t, n.x + n.w - 12 - cw / 2, cy + 0.5);
      c.textAlign = "left";
    }
    if (n.kind === "e") {
      c.font = `600 12px ${FONT}`;
      c.fillStyle = C.empty;
      c.textAlign = "right";
      c.fillText("сул суудал", n.x + n.w - 12, cy + 0.5);
      c.textAlign = "left";
    }
  }
  return cv;
}

/** JPEG зургийг нэг хуудастай PDF болгоно (нэмэлт сан ашиглахгүй). */
export function jpegPdf(jpeg: Uint8Array, pxW: number, pxH: number, ptW: number, ptH: number): Blob {
  const enc = new TextEncoder();
  const chunks: BlobPart[] = [];
  const offs: number[] = [];
  let len = 0;
  const push = (d: string | Uint8Array) => {
    const b = typeof d === "string" ? enc.encode(d) : d;
    chunks.push(b as BlobPart);
    len += b.length;
  };
  const obj = (n: number, body: string) => {
    offs[n] = len;
    push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW.toFixed(2)} ${ptH.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  offs[4] = len;
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  push(jpeg);
  push("\nendstream\nendobj\n");
  const content = `q ${ptW.toFixed(2)} 0 0 ${ptH.toFixed(2)} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = len;
  push("xref\n0 6\n0000000000 65535 f \n" + [1, 2, 3, 4, 5].map((n) => `${String(offs[n]).padStart(10, "0")} 00000 n \n`).join(""));
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: "application/pdf" });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

const blobOf = (cv: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob | null>((res) => cv.toBlob(res, type, q));

export async function exportMap(fmt: "png" | "pdf", nodes: XNode[], edges: XEdge[], W: number, H: number, title: string, file: string): Promise<boolean> {
  const cv = renderMap(nodes, edges, W, H, title);
  if (fmt === "png") {
    const b = await blobOf(cv, "image/png");
    if (!b) return false;
    download(b, `${file}.png`);
    return true;
  }
  const j = await blobOf(cv, "image/jpeg", 0.92);
  if (!j) return false;
  // PDF хуудасны хэмжээ: 1 CSS px = 0.75pt; PDF-ийн дээд хязгаар 14400pt.
  const k = Math.min(0.75, 14400 / W, 14400 / H);
  download(jpegPdf(new Uint8Array(await j.arrayBuffer()), cv.width, cv.height, W * k, H * k), `${file}.pdf`);
  return true;
}
