import { getPageCtx } from "@/server/auth/page";
import { forOrg } from "@/server/db/dal";
import { rawPrisma } from "@/server/db/client";
import { can } from "@/server/auth/permissions";
import { ROLE_LABELS } from "@/server/auth/permissions";
import { Sidebar, type NavItem } from "./sidebar";
import { SignOutButton } from "./sign-out";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getPageCtx();
  const db = forOrg(ctx.organisationId);
  const [org, queue, invoicesWaiting, bankChanges] = await Promise.all([
    rawPrisma.organisation.findUnique({ where: { id: ctx.organisationId } }),
    db.action.count({ where: { status: "pending_review" } }),
    db.invoice.count({ where: { status: "under_review" } }),
    db.bankDetailChange.count({ where: { status: "pending" } }),
  ]);
  const role = ctx.user.role;
  const items: NavItem[] = [
    { href: "/", label: "Scorecard", icon: "chart", show: can(role, "scorecard:view") },
    { href: "/review", label: "Review queue", icon: "inbox", badge: queue, show: can(role, "actions:view") },
    { href: "/actions", label: "All actions", icon: "list", show: can(role, "actions:view") },
    { href: "/invoices", label: "Supplier invoices", icon: "receipt", badge: invoicesWaiting, show: can(role, "suppliers:view") },
    { href: "/suppliers", label: "Suppliers", icon: "truck", badge: bankChanges, show: can(role, "suppliers:view") },
    { href: "/replay", label: "Replay testing", icon: "flask", show: can(role, "replay:view") },
    { href: "/rules", label: "Rules", icon: "rules", show: can(role, "rules:view") },
    { href: "/autonomy", label: "Autonomy", icon: "gauge", show: can(role, "autonomy:view") },
    { href: "/audit", label: "Audit trail", icon: "shield", show: can(role, "audit:view") },
    { href: "/settings", label: "Settings", icon: "settings", show: can(role, "settings:view") },
  ];
  return (
    <div className="flex min-h-screen">
      <Sidebar items={items.filter((i) => i.show)} orgName={org?.name ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-4 border-b border-border bg-surface px-6">
          {role === "auditor" ? (
            <span className="rounded-full bg-info-soft px-2.5 py-0.5 text-xs font-medium text-info">Read-only access</span>
          ) : null}
          <div className="text-right leading-tight">
            <div className="text-sm font-medium" data-testid="current-user">{ctx.user.name}</div>
            <div className="text-xs text-muted">{ROLE_LABELS[role]}</div>
          </div>
          <SignOutButton />
        </header>
        <main className="mx-auto w-full max-w-[1280px] flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
