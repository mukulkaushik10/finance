import { getPageCtx } from "@/server/auth/page";
import { can } from "@/server/auth/permissions";
import { listRules } from "@/server/rules/service";
import { getPrimaryWorkflow } from "@/server/workflows/service";
import { PageHeader } from "@/components/ui";
import { RulesEditor } from "./rules-editor";

export const metadata = { title: "Rules" };

export default async function RulesPage() {
  const ctx = await getPageCtx("rules:view");
  const wf = await getPrimaryWorkflow(ctx);
  const rules = await listRules(ctx, wf.id);
  return (
    <>
      <PageHeader
        title="Rules"
        description="Your company policy, checked on every invoice before the agent can act. Changes apply to the very next invoice and every change is kept in the audit trail."
      />
      <RulesEditor
        workflowId={wf.id}
        currency={wf.currency}
        canEdit={can(ctx.user.role, "rules:edit")}
        rules={JSON.parse(JSON.stringify(rules))}
      />
    </>
  );
}
