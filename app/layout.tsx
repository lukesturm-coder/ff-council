import type { Metadata } from "next";
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
        {children}
      </body>
    </html>
  );
}
