import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ErrorReporter } from "@/components/ErrorReporter";
import { SwRegister } from "@/components/Pwa";
import { getLang, getT } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: { default: t("Хуягтан"), template: `%s · ${t("Хуягтан")}` },
    description: t("Хуягтан өргөөний бүртгэл, онгодын mind map"),
    robots: { index: false, follow: false },
    icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
    appleWebApp: { capable: true, title: "Хуягтан", statusBarStyle: "default" },
  };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#1E4FA0" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={await getLang()}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Manrope:wght@600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ErrorReporter />
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
