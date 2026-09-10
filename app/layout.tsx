import type { Metadata } from "next";
import "./globals.css";
import { StoreProvider } from "./store";
import { AuthGate, AuthProvider } from "./auth";
import PWARegister from "./pwa-register";

export const metadata: Metadata = {
  title: "OV Stock House",
  description: "Inventory management dashboard and barcode stock scanner for e-commerce sellers.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AuthGate>
            <StoreProvider>
              <PWARegister />
              {children}
            </StoreProvider>
          </AuthGate>
        </AuthProvider>
      </body>
    </html>
  );
}
