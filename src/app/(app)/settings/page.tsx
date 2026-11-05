import { getPageCtx } from "@/server/auth/page";
import { can } from "@/server/auth/permissions";
import { listAgents, listUsers, listVendors } from "@/server/settings/service";
import { getPrimaryWorkflow } from "@/server/workflows/service";
import { ERP_CONNECTORS } from "@/server/connectors/erp";
import { listBankAccounts } from "@/server/banking/service";
import { PageHeader } from "@/components/ui";
import { SettingsTabs } from "./settings-tabs";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const ctx = await getPageCtx("settings:view");
  const sp = await searchParams;
  const [agents, vendors, users, wf, bankAccounts] = await Promise.all([listAgents(ctx), listVendors(ctx, sp.q), listUsers(ctx), getPrimaryWorkflow(ctx), listBankAccounts(ctx, { includeArchived: true })]);
  return (
    <>
      <PageHeader title="Settings" description="Connect agents and your system of record, manage vendors flagged for control, set up the bank accounts you pay suppliers from, and decide who can do what." />
      <SettingsTabs
        initialTab={sp.tab ?? "agents"}
        canEdit={can(ctx.user.role, "settings:edit")}
        appUrl={process.env.APP_URL ?? "http://localhost:3000"}
        workflow={{ id: wf.id, erpConnector: wf.erpConnector }}
        connectors={ERP_CONNECTORS}
        currentUserId={ctx.user.id}
        q={sp.q ?? ""}
        data={JSON.parse(JSON.stringify({ agents, vendors, users, bankAccounts }, (_k, v) => (typeof v === "bigint" ? Number(v) : v)))}
      />
    </>
  );
}
