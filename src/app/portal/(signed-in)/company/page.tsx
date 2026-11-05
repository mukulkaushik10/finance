import { getVendorPageCtx } from "@/server/portal/page";
import { getSupplierProfile } from "@/server/portal/profile";
import { PageHeader } from "@/components/ui";
import { CompanyForm } from "./form";

export const metadata = { title: "Supplier portal · Company" };

export default async function CompanyPage() {
  const ctx = await getVendorPageCtx();
  const p = await getSupplierProfile(ctx);
  return (
    <>
      <PageHeader title="Company details" description="Printed on every invoice you send. Your buyers see these details too." />
      <CompanyForm canEdit={ctx.user.role === "owner"} initial={{ legalName: p.legalName, taxId: p.taxId ?? "", email: p.email, phone: p.phone ?? "", addressLine1: p.addressLine1 ?? "", addressLine2: p.addressLine2 ?? "", city: p.city ?? "", region: p.region ?? "", postalCode: p.postalCode ?? "" }} />
    </>
  );
}
