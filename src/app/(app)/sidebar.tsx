"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, FlaskConical, Gauge, Inbox, List, Scale, Settings, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";
import { Logo } from "@/components/logo";

export interface NavItem { href: string; label: string; icon: string; badge?: number; show: boolean }

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  chart: BarChart3, inbox: Inbox, list: List, flask: FlaskConical, rules: Scale, gauge: Gauge, shield: ShieldCheck, settings: Settings,
};

export function Sidebar({ items, orgName }: { items: NavItem[]; orgName: string }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-4">
        <Logo />
        <div className="min-w-0 leading-tight">
          <div className="text-sm font-semibold">Control Room</div>
          <div className="truncate text-xs text-muted">{orgName}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.badge ? (
                <span className={cn("rounded-full px-1.5 text-xs tabular", active ? "bg-brand text-white" : "bg-warn-soft text-warn")} data-testid={`nav-badge-${item.icon}`}>{item.badge}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3 text-xs text-muted">Accounts payable · USD</div>
    </aside>
  );
}
