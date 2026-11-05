"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";

const ITEMS = [["/portal", "Home"], ["/portal/invoices", "Invoices"], ["/portal/bank", "Bank details"], ["/portal/company", "Company"]];

export function PortalNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1">
      {ITEMS.map(([href, label]) => {
        const active = href === "/portal" ? path === "/portal" : path.startsWith(href);
        return <Link key={href} href={href} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", active ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2")}>{label}</Link>;
      })}
    </nav>
  );
}

export function PortalSignOut() {
  return <Button variant="ghost" size="sm" onClick={async () => { await fetch("/api/portal/auth/logout", { method: "POST" }); window.location.href = "/portal/login"; }}>Sign out</Button>;
}
