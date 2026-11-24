export const metadata = {
  title: "Huyagtan Mindmap",
  description: "huyagtan.mn",
};

export default function RootLayout({ children }) {
  return (
    <html lang="mn">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>{children}</body>
    </html>
  );
}
