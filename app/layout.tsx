import type { Metadata, Viewport } from "next";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BrocheLink — QR Codes dinâmicos para broches", template: "%s · BrocheLink" },
  description: "Ative seu broche, escolha para onde o QR Code leva e mude quando quiser — sem reimprimir.",
  applicationName: "BrocheLink",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#121117" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-dvh antialiased">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:pt-10">{children}</main>
        <footer className="border-t border-line py-6 text-center text-xs text-muted">
          BrocheLink · QR Codes dinâmicos para broches físicos
        </footer>
      </body>
    </html>
  );
}
