import { getDirection, resolveUiLanguage } from "@traiblazer/i18n";
import type { Metadata, Viewport } from "next";
import { Google_Sans_Flex } from "next/font/google";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { AppRuntime } from "@/components/app/AppRuntime";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

const sans = Google_Sans_Flex({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Traiblazer",
  description: "AI assistants for small businesses",
  applicationName: "Traiblazer",
  // Installable owner app (PLAN §20); the manifest comes from src/app/manifest.ts.
  appleWebApp: { capable: true, title: "Traiblazer", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3f5fb" },
    { media: "(prefers-color-scheme: dark)", color: "#111318" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieLang = (await cookies()).get("tb_lang")?.value;
  const requestHeaders = await headers();
  // Marketing pages (/en/…, /fr/…) carry their language in the address; see src/proxy.ts.
  const pathLang = requestHeaders.get("x-tb-lang");
  const headerLang = requestHeaders.get("accept-language")?.split(",")[0];
  const language = resolveUiLanguage(pathLang ?? cookieLang ?? headerLang);

  return (
    <html lang={language} dir={getDirection(language)} className={sans.variable}>
      <body className="min-h-screen antialiased">
        <I18nProvider language={language}>
          <AppRuntime />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
