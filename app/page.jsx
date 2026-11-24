export default function Home() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", textAlign: "center", padding: 16 }}>
      <div>
        <h1>huyagtan.mn</h1>
        <p>Удахгүй нээгдэнэ. GitHub-аас автомат deploy ажиллаж байна.</p>
        <p style={{ color: "#888", fontSize: 14 }}>Build: {process.env.NEXT_PUBLIC_BUILD_SHA || "local"}</p>
      </div>
    </main>
  );
}
