import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Warranted — Policy Dashboard",
  description: "Rules engine management dashboard for Warranted compliance platform",
};

const navItems = [
  { href: "/policies", label: "Policies" },
  { href: "/agents", label: "Agents" },
  { href: "/groups", label: "Groups" },
  { href: "/petitions", label: "Petitions" },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex">
        <aside className="w-56 border-r border-border bg-muted/30 flex flex-col p-4 gap-1 shrink-0 min-h-screen">
          <Link href="/" className="text-lg font-semibold px-3 py-2 mb-4">
            Warranted
          </Link>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </body>
    </html>
  );
}
