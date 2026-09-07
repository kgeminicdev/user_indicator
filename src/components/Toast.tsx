"use client";

import { useEffect, useState } from "react";

type ToastVariant = "success" | "error" | "info";
type Toast = { id: number; message: string; variant: ToastVariant };

let toasts: Toast[] = [];
let listeners: Array<(toasts: Toast[]) => void> = [];
let nextId = 1;

function emit() {
  for (const listener of listeners) listener(toasts);
}

// Fire-and-forget notification from anywhere in the app (no context/provider
// needed) — picked up by the single <ToastContainer /> mounted in the root
// layout. Replaces alert()'s blocking popup with an auto-dismissing banner.
export function notify(message: string, variant: ToastVariant = "info") {
  const id = nextId++;
  toasts = [...toasts, { id, message, variant }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, 5000);
}

export default function ToastContainer() {
  const [items, setItems] = useState<Toast[]>(toasts);

  useEffect(() => {
    listeners.push(setItems);
    return () => {
      listeners = listeners.filter((l) => l !== setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`flex items-start justify-between gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg ${
            t.variant === "error"
              ? "bg-red-600 text-white"
              : t.variant === "success"
                ? "bg-emerald-600 text-white"
                : "bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-900"
          }`}
        >
          <span>{t.message}</span>
          <button
            onClick={() => {
              toasts = toasts.filter((x) => x.id !== t.id);
              emit();
            }}
            className="shrink-0 opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
