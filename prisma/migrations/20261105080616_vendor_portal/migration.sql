-- CreateEnum
CREATE TYPE "BankAccountState" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "VendorUserRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "VendorConnectionStatus" AS ENUM ('invited', 'active', 'suspended');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'needs_changes', 'rejected', 'scheduled', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('invoice', 'credit_note');

-- CreateEnum
CREATE TYPE "BankChangeStatus" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "billingAddress" TEXT;

-- CreateTable
CREATE TABLE "OrganisationBankAccount" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "routingNumber" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "state" "BankAccountState" NOT NULL DEFAULT 'active',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganisationBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorAccount" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "taxId" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorUser" (
    "id" TEXT NOT NULL,
    "vendorAccountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "VendorUserRole" NOT NULL DEFAULT 'owner',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorBankAccount" (
    "id" TEXT NOT NULL,
    "vendorAccountId" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "routingNumber" TEXT NOT NULL,
    "accountLast4" TEXT NOT NULL,
    "accountNumberEnc" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorConnection" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorAccountId" TEXT,
    "status" "VendorConnectionStatus" NOT NULL DEFAULT 'invited',
    "inviteEmail" TEXT NOT NULL,
    "inviteTokenHash" TEXT,
    "inviteExpiresAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "bankAccountId" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,

    CONSTRAINT "VendorConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankDetailChange" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "vendorAccountId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "newBankAccountId" TEXT NOT NULL,
    "previousBankAccountId" TEXT,
    "status" "BankChangeStatus" NOT NULL DEFAULT 'pending',
    "requestedByName" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decidedAt" TIMESTAMP(3),
    "verification" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "BankDetailChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "vendorAccountId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "kind" "InvoiceKind" NOT NULL DEFAULT 'invoice',
    "creditForInvoiceId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "poNumber" TEXT,
    "grnNumber" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "subtotalMinor" BIGINT NOT NULL DEFAULT 0,
    "taxMinor" BIGINT NOT NULL DEFAULT 0,
    "totalMinor" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "bankFingerprint" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "actionId" TEXT,
    "supplierNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "scheduledFor" TIMESTAMP(3),
    "payFromAccountId" TEXT,
    "paidAt" TIMESTAMP(3),
    "paymentReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "vendorAccountId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "amountMinor" BIGINT NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "vendorAccountId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL,
    "note" TEXT,
    "actorType" TEXT NOT NULL,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceMessage" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "vendorAccountId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "authorType" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrganisationBankAccount_organisationId_idx" ON "OrganisationBankAccount"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorUser_email_key" ON "VendorUser"("email");

-- CreateIndex
CREATE INDEX "VendorUser_vendorAccountId_idx" ON "VendorUser"("vendorAccountId");

-- CreateIndex
CREATE INDEX "VendorBankAccount_vendorAccountId_idx" ON "VendorBankAccount"("vendorAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorConnection_vendorId_key" ON "VendorConnection"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "VendorConnection_inviteTokenHash_key" ON "VendorConnection"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "VendorConnection_organisationId_status_idx" ON "VendorConnection"("organisationId", "status");

-- CreateIndex
CREATE INDEX "VendorConnection_vendorAccountId_idx" ON "VendorConnection"("vendorAccountId");

-- CreateIndex
CREATE INDEX "BankDetailChange_organisationId_status_idx" ON "BankDetailChange"("organisationId", "status");

-- CreateIndex
CREATE INDEX "BankDetailChange_vendorAccountId_idx" ON "BankDetailChange"("vendorAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_actionId_key" ON "Invoice"("actionId");

-- CreateIndex
CREATE INDEX "Invoice_organisationId_status_idx" ON "Invoice"("organisationId", "status");

-- CreateIndex
CREATE INDEX "Invoice_vendorAccountId_status_idx" ON "Invoice"("vendorAccountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_connectionId_kind_invoiceNumber_key" ON "Invoice"("connectionId", "kind", "invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceEvent_invoiceId_createdAt_idx" ON "InvoiceEvent"("invoiceId", "createdAt");

-- CreateIndex
CREATE INDEX "InvoiceMessage_invoiceId_createdAt_idx" ON "InvoiceMessage"("invoiceId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrganisationBankAccount" ADD CONSTRAINT "OrganisationBankAccount_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorUser" ADD CONSTRAINT "VendorUser_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "VendorAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorBankAccount" ADD CONSTRAINT "VendorBankAccount_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "VendorAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorConnection" ADD CONSTRAINT "VendorConnection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorConnection" ADD CONSTRAINT "VendorConnection_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorConnection" ADD CONSTRAINT "VendorConnection_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "VendorAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorConnection" ADD CONSTRAINT "VendorConnection_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "VendorBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDetailChange" ADD CONSTRAINT "BankDetailChange_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDetailChange" ADD CONSTRAINT "BankDetailChange_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "VendorAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDetailChange" ADD CONSTRAINT "BankDetailChange_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "VendorConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDetailChange" ADD CONSTRAINT "BankDetailChange_newBankAccountId_fkey" FOREIGN KEY ("newBankAccountId") REFERENCES "VendorBankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankDetailChange" ADD CONSTRAINT "BankDetailChange_previousBankAccountId_fkey" FOREIGN KEY ("previousBankAccountId") REFERENCES "VendorBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "VendorAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "VendorConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_payFromAccountId_fkey" FOREIGN KEY ("payFromAccountId") REFERENCES "OrganisationBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "VendorAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "VendorAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceMessage" ADD CONSTRAINT "InvoiceMessage_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceMessage" ADD CONSTRAINT "InvoiceMessage_vendorAccountId_fkey" FOREIGN KEY ("vendorAccountId") REFERENCES "VendorAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceMessage" ADD CONSTRAINT "InvoiceMessage_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
