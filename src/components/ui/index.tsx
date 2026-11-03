import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

// shadcn/ui-style primitives (same copy-into-repo model, kept dependency-free).

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "good";
const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand/90 shadow-sm",
  secondary: "bg-surface text-ink border border-border-strong hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2",
  danger: "bg-bad text-white hover:bg-bad/90 shadow-sm",
  good: "bg-good text-white hover:bg-good/90 shadow-sm",
};
const sizes = { sm: "h-8 px-3 text-sm", md: "h-9 px-4 text-sm", lg: "h-11 px-5 text-base" };

export function Button({
  variant = "primary", size = "md", className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: keyof typeof sizes }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap",
        buttonStyles[variant], sizes[size], className,
      )}
      {...props}
    />
  );
}

export function LinkButton({
  href, variant = "secondary", size = "md", className, children, ...rest
}: { href: string; variant?: ButtonVariant; size?: keyof typeof sizes; className?: string; children: React.ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link href={href} className={cn("inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors whitespace-nowrap", buttonStyles[variant], sizes[size], className)} {...rest}>
      {children}
    </Link>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]", className)} {...props} />;
}
export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-border px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

export type Tone = "good" | "warn" | "bad" | "info" | "neutral" | "brand";
const toneStyles: Record<Tone, string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  neutral: "bg-neutral-soft text-ink-2",
  brand: "bg-brand-soft text-brand",
};
export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", toneStyles[tone], className)} {...props} />;
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn("h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-surface-2", className)}
      {...props}
    />
  );
});

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn("w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20", className)}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn("h-9 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-surface-2", className)}
      {...props}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1 block text-sm font-medium text-ink-2", className)} {...props} />;
}

export function Field({ label, hint, error, children, className }: { label: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
      {error ? <p className="mt-1 text-xs text-bad">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: Tone; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border px-4 py-3 text-sm", toneStyles[tone], "border-current/15", className)} role={tone === "bad" ? "alert" : "status"}>
      {title ? <div className="font-semibold">{title}</div> : null}
      {children ? <div className={cn(title ? "mt-0.5" : "", "text-ink-2")}>{children}</div> : null}
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("border-b border-border bg-surface-2/60 px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted whitespace-nowrap", className)} {...props} />;
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-border px-4 py-2.5 align-top text-ink-2", className)} {...props} />;
}

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="text-base font-semibold text-ink">{title}</div>
      {children ? <div className="mt-1 max-w-md text-sm text-muted">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: Tone }) {
  const inner = (
    <>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular", tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-muted">{sub}</div> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-brand/50 hover:bg-brand-soft/30">{inner}</Link>
  ) : (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">{inner}</div>
  );
}
