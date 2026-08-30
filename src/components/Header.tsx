"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Search" },
  { href: "/braintrust", label: "Braintrust" },
  { href: "/todo", label: "To Do" },
];

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="flex justify-center border-b border-black/10 bg-white dark:border-white/10 dark:bg-black">
      <nav className="flex w-full max-w-3xl gap-1 px-6 py-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-foreground text-background"
                  : "text-zinc-600 hover:bg-black/5 dark:text-zinc-400 dark:hover:bg-white/10"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
