"use client";
import type { SelectHTMLAttributes } from "react";

/** Сонголт өөрчлөгдөхөд эцэг формыг шууд илгээдэг select. */
export function AutoSubmitSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

/** Устгах зэрэг буцаахгүй үйлдлийн өмнө баталгаажуулах товч. */
export function ConfirmButton({ message, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { message: string }) {
  return (
    <button {...rest} onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </button>
  );
}
