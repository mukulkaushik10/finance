import { cookies } from "next/headers";
import { Logo } from "@/components/logo";
import { Alert, Card, CardBody } from "@/components/ui";
import { getInvitePreview } from "@/server/portal/auth";
import { VENDOR_SESSION_COOKIE, vendorCtxFromToken } from "@/server/portal/session";
import { AppError } from "@/server/errors";
import { AcceptInviteForm } from "./form";

export const metadata = { title: "Supplier portal · Invitation" };
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let invite: Awaited<ReturnType<typeof getInvitePreview>> | null = null;
  let problem: string | null = null;
  try { invite = await getInvitePreview(token); } catch (e) { problem = e instanceof AppError ? (e.status === 404 ? "This invitation link isn't valid, or it has already been used." : e.message) : "Something went wrong"; }
  const signedIn = await vendorCtxFromToken((await cookies()).get(VENDOR_SESSION_COOKIE)?.value);
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-2 px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center gap-2.5"><Logo /><div className="text-lg font-semibold">Supplier portal</div></div>
        {problem || !invite ? <Alert tone="bad" title="Can't open this invitation">{problem} Ask the company that invited you to send a new one.</Alert> : (
          <Card>
            <CardBody className="space-y-4 py-6">
              <div>
                <h1 className="text-xl font-semibold">{invite.buyerName} invited you to send invoices online</h1>
                <p className="mt-1 text-sm text-muted">They know you as <span className="font-medium text-ink">{invite.supplierName}</span>. Through the portal you can turn their purchase orders into invoices, see exactly where each invoice is, and know when you’ll be paid. Payment terms: {invite.paymentTermsDays} days. It’s free for suppliers.</p>
              </div>
              <AcceptInviteForm token={token} email={invite.email} supplierName={invite.supplierName} hasAccount={invite.hasAccount} signedInAs={signedIn ? signedIn.user.email : null} />
            </CardBody>
          </Card>
        )}
      </div>
    </main>
  );
}
