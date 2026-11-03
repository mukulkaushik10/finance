import { LoginForm } from "./login-form";
import { Logo } from "@/components/logo";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  const demo = process.env.NODE_ENV !== "production" || process.env.DEMO_MODE === "1";
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <Logo />
          <div>
            <div className="text-lg font-semibold">Control Room</div>
            <div className="text-xs text-muted">Assurance for AI agents that touch money</div>
          </div>
        </div>
        <LoginForm demo={demo} />
      </div>
    </main>
  );
}
