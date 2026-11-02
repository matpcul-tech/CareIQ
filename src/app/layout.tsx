import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  title: "CareIQ",
  description:
    "Clinical intelligence for the safety net. Records are encrypted at rest on the application server. Built by Sovereign Shield Technologies LLC.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#07101f",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Reading the nonce here is the documented Next.js pattern for nonce-based
  // CSP. Next.js will automatically apply this nonce to any inline scripts
  // and style tags it injects for hydration and streaming.
  const nonce = headers().get("x-nonce") || undefined;

  return (
    <html lang="en" className="bg-sov-bg text-ink antialiased">
      <head>
        {nonce ? <meta property="csp-nonce" content={nonce} /> : null}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;800&family=DM+Mono:wght@300;400;500&family=Outfit:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-sov-bg text-ink font-sans">{children}</body>
    </html>
  );
}
