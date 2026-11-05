import { Logo } from "@/components/logo";
import { SupplierLoginForm } from "./form";

export const metadata = { title: "Supplier portal · Sign in" };

export default function SupplierLoginPage() {
  const demo = process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "1";
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-2 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo />
          <div>
            <div className="text-lg font-semibold">Supplier portal</div>
            <div className="text-xs text-muted">Send invoices and see when you’ll be paid</div>
          </div>
        </div>
        <SupplierLoginForm demo={demo} />
        <p className="mt-4 text-center text-xs text-muted">New here? Suppliers join through an invitation from the company they bill. <a href="/login" className="underline">Staff sign-in</a></p>
      </div>
    </main>
  );
}
