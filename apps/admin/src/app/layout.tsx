import { getDirection, resolveUiLanguage } from "@traiblazer/i18n";
import type { Metadata } from "next";
import { Google_Sans_Flex } from "next/font/google";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

const sans = Google_Sans_Flex({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Traiblazer",
  description: "AI assistants for small businesses",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieLang = (await cookies()).get("tb_lang")?.value;
  const headerLang = (await headers()).get("accept-language")?.split(",")[0];
  const language = resolveUiLanguage(cookieLang ?? headerLang);

  return (
    <html lang={language} dir={getDirection(language)} className={sans.variable}>
      <body className="min-h-screen antialiased">
        <I18nProvider language={language}>{children}</I18nProvider>
      </body>
    </html>
  );
}
