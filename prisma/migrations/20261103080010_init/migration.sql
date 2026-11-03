-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'controller', 'reviewer', 'auditor');

-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('ap_invoice');

-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('webhook', 'mock');

-- CreateEnum
CREATE TYPE "Decision" AS ENUM ('approve', 'reject', 'escalate');

-- CreateEnum
CREATE TYPE "GateOutcome" AS ENUM ('auto_approve', 'needs_human', 'block');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('logged', 'auto_approved', 'pending_review', 'approved', 'rejected', 'blocked');

-- CreateEnum
CREATE TYPE "ActionSource" AS ENUM ('live', 'replay');

-- CreateEnum
CREATE TYPE "RuleType" AS ENUM ('three_way_match', 'approval_limit', 'duplicate_invoice', 'bank_details_change', 'blocked_vendor', 'custom_condition');

-- CreateEnum
CREATE TYPE "RuleSeverity" AS ENUM ('review', 'block');

-- CreateEnum
CREATE TYPE "RuleResultValue" AS ENUM ('pass', 'fail', 'not_applicable');

-- CreateEnum
CREATE TYPE "ReplayRunStatus" AS ENUM ('queued', 'running', 'completed', 'failed');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendorName" TEXT,
    "kind" "AgentKind" NOT NULL,
    "endpointUrl" TEXT,
    "callbackUrl" TEXT,
    "signingSecret" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "apiKeyPrefix" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "mockConfig" JSONB,
    "costPerActionMinor" BIGINT NOT NULL DEFAULT 0,
    "costCurrency" TEXT NOT NULL DEFAULT 'USD',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "type" "WorkflowType" NOT NULL,
    "name" TEXT NOT NULL,
    "autonomyLevel" INTEGER NOT NULL DEFAULT 0,
    "autoApproveLimitMinor" BIGINT NOT NULL DEFAULT 500000,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "confidenceThresholdBps" INTEGER NOT NULL DEFAULT 8500,
    "promotionWindow" INTEGER NOT NULL DEFAULT 50,
    "promotionTargetBps" INTEGER NOT NULL DEFAULT 9500,
    "erpConnector" TEXT NOT NULL DEFAULT 'fake_quickbooks',
    "primaryAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutonomyChange" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "fromLevel" INTEGER NOT NULL,
    "toLevel" INTEGER NOT NULL,
    "accuracyBps" INTEGER,
    "sampleSize" INTEGER,
    "confirmedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutonomyChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "type" "RuleType" NOT NULL,
    "name" TEXT NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleVersion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "params" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "changeNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "defaultGlCode" TEXT NOT NULL,
    "bankFingerprint" TEXT NOT NULL,
    "bankChangedAt" TIMESTAMP(3),
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "vendorCode" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "quantityReceived" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "source" "ActionSource" NOT NULL DEFAULT 'live',
    "idempotencyKey" TEXT,
    "subjectType" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "counterpartyKey" TEXT NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "occurredOn" TIMESTAMP(3),
    "payload" JSONB NOT NULL,
    "proposedDecision" "Decision" NOT NULL,
    "proposedGlCode" TEXT,
    "agentReason" TEXT,
    "agentConfidenceBps" INTEGER,
    "gateOutcome" "GateOutcome" NOT NULL,
    "computedOutcome" "GateOutcome" NOT NULL,
    "enforced" BOOLEAN NOT NULL,
    "gateReasons" JSONB NOT NULL,
    "requiredRole" "Role",
    "autonomyLevel" INTEGER NOT NULL,
    "ruleSetVersion" TEXT NOT NULL,
    "status" "ActionStatus" NOT NULL,
    "costMinor" BIGINT NOT NULL DEFAULT 0,
    "costCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleResult" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "ruleVersionId" TEXT NOT NULL,
    "ruleName" TEXT NOT NULL,
    "ruleType" "RuleType" NOT NULL,
    "severity" "RuleSeverity" NOT NULL,
    "result" "RuleResultValue" NOT NULL,
    "explanation" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "RuleResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "Decision" NOT NULL,
    "correctDecision" "Decision" NOT NULL,
    "agentWasCorrect" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayDataset" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayDataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayCase" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "externalRef" TEXT NOT NULL,
    "counterpartyName" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expectedDecision" "Decision" NOT NULL,
    "expectedGlCode" TEXT,
    "fileId" TEXT,

    CONSTRAINT "ReplayCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayComparison" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "datasetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayComparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayRun" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "agentVersion" TEXT NOT NULL,
    "status" "ReplayRunStatus" NOT NULL DEFAULT 'queued',
    "totalCases" INTEGER NOT NULL,
    "processedCases" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReplayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReplayResult" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "agentDecision" "Decision",
    "agentGlCode" TEXT,
    "agentReason" TEXT,
    "agentConfidenceBps" INTEGER,
    "error" TEXT,
    "decisionCorrect" BOOLEAN NOT NULL,
    "glCorrect" BOOLEAN,
    "gatedOutcome" "GateOutcome",
    "failedRules" JSONB NOT NULL DEFAULT '[]',
    "latencyMs" INTEGER NOT NULL,

    CONSTRAINT "ReplayResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRecord" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoredFile" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organisationId_idx" ON "User"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_apiKeyHash_key" ON "Agent"("apiKeyHash");

-- CreateIndex
CREATE INDEX "Agent_organisationId_idx" ON "Agent"("organisationId");

-- CreateIndex
CREATE INDEX "Workflow_organisationId_idx" ON "Workflow"("organisationId");

-- CreateIndex
CREATE INDEX "AutonomyChange_organisationId_workflowId_idx" ON "AutonomyChange"("organisationId", "workflowId");

-- CreateIndex
CREATE INDEX "Rule_organisationId_workflowId_idx" ON "Rule"("organisationId", "workflowId");

-- CreateIndex
CREATE INDEX "RuleVersion_organisationId_idx" ON "RuleVersion"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "RuleVersion_ruleId_version_key" ON "RuleVersion"("ruleId", "version");

-- CreateIndex
CREATE INDEX "Vendor_organisationId_name_idx" ON "Vendor"("organisationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_organisationId_code_key" ON "Vendor"("organisationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_organisationId_poNumber_key" ON "PurchaseOrder"("organisationId", "poNumber");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_organisationId_grnNumber_key" ON "GoodsReceipt"("organisationId", "grnNumber");

-- CreateIndex
CREATE INDEX "Action_organisationId_workflowId_createdAt_idx" ON "Action"("organisationId", "workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "Action_organisationId_status_idx" ON "Action"("organisationId", "status");

-- CreateIndex
CREATE INDEX "Action_organisationId_counterpartyKey_idx" ON "Action"("organisationId", "counterpartyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Action_organisationId_agentId_idempotencyKey_key" ON "Action"("organisationId", "agentId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "RuleResult_organisationId_actionId_idx" ON "RuleResult"("organisationId", "actionId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_actionId_key" ON "Review"("actionId");

-- CreateIndex
CREATE INDEX "Review_organisationId_createdAt_idx" ON "Review"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "ReplayCase_organisationId_datasetId_rowNumber_idx" ON "ReplayCase"("organisationId", "datasetId", "rowNumber");

-- CreateIndex
CREATE INDEX "ReplayResult_organisationId_runId_idx" ON "ReplayResult"("organisationId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "ReplayResult_runId_caseId_key" ON "ReplayResult"("runId", "caseId");

-- CreateIndex
CREATE INDEX "AuditRecord_organisationId_entityType_entityId_idx" ON "AuditRecord"("organisationId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditRecord_organisationId_occurredAt_idx" ON "AuditRecord"("organisationId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRecord_organisationId_seq_key" ON "AuditRecord"("organisationId", "seq");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_primaryAgentId_fkey" FOREIGN KEY ("primaryAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutonomyChange" ADD CONSTRAINT "AutonomyChange_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutonomyChange" ADD CONSTRAINT "AutonomyChange_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleVersion" ADD CONSTRAINT "RuleVersion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleVersion" ADD CONSTRAINT "RuleVersion_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleResult" ADD CONSTRAINT "RuleResult_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleResult" ADD CONSTRAINT "RuleResult_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleResult" ADD CONSTRAINT "RuleResult_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "RuleVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayDataset" ADD CONSTRAINT "ReplayDataset_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayDataset" ADD CONSTRAINT "ReplayDataset_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayCase" ADD CONSTRAINT "ReplayCase_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayCase" ADD CONSTRAINT "ReplayCase_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ReplayDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayComparison" ADD CONSTRAINT "ReplayComparison_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayComparison" ADD CONSTRAINT "ReplayComparison_datasetId_fkey" FOREIGN KEY ("datasetId") REFERENCES "ReplayDataset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayRun" ADD CONSTRAINT "ReplayRun_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayRun" ADD CONSTRAINT "ReplayRun_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "ReplayComparison"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayRun" ADD CONSTRAINT "ReplayRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayResult" ADD CONSTRAINT "ReplayResult_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayResult" ADD CONSTRAINT "ReplayResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReplayRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReplayResult" ADD CONSTRAINT "ReplayResult_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReplayCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRecord" ADD CONSTRAINT "AuditRecord_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
