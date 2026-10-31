import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lagrowth Machine Tracker · Campaign Analytics",
  description: "An invite-only campaign analytics dashboard for La Growth Machine accounts.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
