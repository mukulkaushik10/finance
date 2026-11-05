import { getVendorPageCtx } from "@/server/portal/page";
import { Logo } from "@/components/logo";
import { PortalNav, PortalSignOut } from "./nav";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getVendorPageCtx();
  return (
    <div className="min-h-screen bg-surface-2/60">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex h-14 max-w-[1100px] items-center gap-6 px-6">
          <div className="flex items-center gap-2.5">
            <Logo />
            <div className="leading-tight">
              <div className="text-sm font-semibold">Supplier portal</div>
              <div className="text-xs text-muted" data-testid="supplier-account">{ctx.accountName}</div>
            </div>
          </div>
          <PortalNav />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-ink-2 sm:inline">{ctx.user.name}</span>
            <PortalSignOut />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1100px] px-6 py-6">{children}</main>
    </div>
  );
}
