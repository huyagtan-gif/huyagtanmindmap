"use client";
import { useEffect } from "react";
import { reportClientError } from "@/components/ErrorReporter";

// Хуудас ачаалахад алдаа гарвал хэрэглэгчид ойлгомжтой мессеж харуулна (P2.9).
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // digest-тэй бол серверийн алдаа: сервер өөрөө аль хэдийн бүртгэсэн.
    if (!error.digest) reportClientError(error);
  }, [error]);
  return (
    <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card col g12" style={{ maxWidth: 440, textAlign: "center", alignItems: "center" }}>
        <h1 style={{ fontSize: 22 }}>Алдаа гарлаа</h1>
        <p className="muted" style={{ margin: 0 }}>Уучлаарай, хуудсыг харуулж чадсангүй. Алдаа автоматаар бүртгэгдсэн. Дахин оролдоно уу.</p>
        {error.digest ? <span className="tiny muted">Алдааны код: {error.digest}</span> : null}
        <div className="row wrap" style={{ justifyContent: "center" }}>
          <button className="btn pri" onClick={() => reset()}>Дахин оролдох</button>
          <a className="btn" href="/map">Нүүр хуудас</a>
        </div>
      </div>
    </div>
  );
}
