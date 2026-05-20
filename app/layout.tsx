import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Header from "./_components/Header";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "FF Council — Council-derived fantasy football rankings",
  description:
    "Crowdsourced fantasy football rankings from the FF Council, with Vegas, ESPN, and FantasyPros as supporting sources.",
};

// Next.js 14 pattern: viewport / themeColor / colorScheme live on the
// dedicated `viewport` export rather than `metadata`. Drives the iOS
// PWA chrome (status bar tint, etc.) and the address-bar color on
// Android Chrome.
export const viewport: Viewport = {
  themeColor: "#09090b",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-zinc-950 text-zinc-100 antialiased`}
      >
        <Header />
        {/* Bottom padding clears the fixed mobile bottom tab bar (md:hidden).
            No-op on desktop, where the bar isn't rendered. */}
        <div className="pb-16 md:pb-0">{children}</div>
      </body>
    </html>
  );
}
