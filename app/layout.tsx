import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "./store";
import PWARegister from "./pwa-register";

export const metadata: Metadata = {
  title: "OV Stock House",
  description: "Inventory management dashboard and barcode stock scanner for e-commerce sellers.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body><StoreProvider><PWARegister />{children}</StoreProvider></body>
    </html>
  );
}
