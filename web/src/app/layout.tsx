import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "mnemex, graph-native memory for AI assistants",
  description:
    "Conversations stored as a Neo4j knowledge graph instead of flat vector chunks, so recall can answer who disagreed and which decision still stands.",
  applicationName: "mnemex",
  openGraph: {
    title: "mnemex, graph-native memory for AI assistants",
    description:
      "A chunk index can find the text of an objection. It cannot tell you who made it, or which of two contradictory decisions still stands. Both are edges.",
    type: "website",
  },
};

// Matches --background so the browser chrome and the overscroll gutter do not
// flash white on a projector.
export const viewport: Viewport = {
  themeColor: "#0a0a0a",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
