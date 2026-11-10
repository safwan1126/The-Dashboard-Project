import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LifeOS",
  description: "Personal operating system — dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint, so there is no flash of
            the default look. Each key maps to one data-* attribute that
            globals.css keys on. */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var e=document.documentElement,s=localStorage;if(s.getItem('darkMode')==='true')e.setAttribute('data-mood','Charcoal');if(s.getItem('glass')==='true')e.setAttribute('data-glass','on');var a=s.getItem('accent');if(a)e.setAttribute('data-accent',a);var v=s.getItem('voice');if(v)e.setAttribute('data-voice',v);}catch(_){}})();` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
