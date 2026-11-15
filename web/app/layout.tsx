import type { Metadata } from "next";
import { JetBrains_Mono, Orbitron } from "next/font/google";
import type { CSSProperties } from "react";
import AccountControl from "@/components/AccountControl";
import NavTracker from "@/components/NavTracker";
import SiteFooter from "@/components/SiteFooter";
import { PROJECT_NAME, PROJECT_TAGLINE } from "@/lib/brand";
import "./globals.css";

const orbitron = Orbitron({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "700", "800"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: PROJECT_NAME,
  description: PROJECT_TAGLINE,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${orbitron.variable} ${mono.variable}`}>
      <body style={{ "--site-footer-h": "32px" } as CSSProperties}>
        <NavTracker />
        <AccountControl />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
