-- Phase C/D: multi-tenant, API keys, PII, compliance audit

CREATE TYPE "PiiLevel" AS ENUM ('NONE', 'LOW', 'HIGH');
CREATE TYPE "ComplianceAuditAction" AS ENUM (
  'API_KEY_AUTH',
  'SNAPSHOT_COMPLIANCE_EXPORT',
  'SCORE_BREAKDOWN_EXPORT',
  'ENTITY_PII_ACCESS'
);

CREATE TABLE "Tenant" (
    "id" BIGSERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

INSERT INTO "Tenant" ("slug", "name", "updatedAt")
VALUES ('default', 'Default tenant', CURRENT_TIMESTAMP);

CREATE TABLE "ApiKey" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" BIGINT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "keyPrefix" VARCHAR(16) NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '["read","write","admin"]',
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX "ApiKey_tenantId_idx" ON "ApiKey"("tenantId");
CREATE INDEX "ApiKey_keyPrefix_idx" ON "ApiKey"("keyPrefix");

ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ComplianceAuditEvent" (
    "id" BIGSERIAL NOT NULL,
    "tenantId" BIGINT,
    "action" "ComplianceAuditAction" NOT NULL,
    "actor" VARCHAR(128) NOT NULL,
    "resource" VARCHAR(256),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplianceAuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ComplianceAuditEvent_tenantId_createdAt_idx"
  ON "ComplianceAuditEvent"("tenantId", "createdAt");
CREATE INDEX "ComplianceAuditEvent_action_createdAt_idx"
  ON "ComplianceAuditEvent"("action", "createdAt");

ALTER TABLE "ComplianceAuditEvent" ADD CONSTRAINT "ComplianceAuditEvent_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Topic" ADD COLUMN "tenantId" BIGINT;
CREATE INDEX "Topic_tenantId_idx" ON "Topic"("tenantId");
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Topic" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "slug" = 'default' LIMIT 1)
WHERE "tenantId" IS NULL;

ALTER TABLE "Entity" ADD COLUMN "tenantId" BIGINT;
ALTER TABLE "Entity" ADD COLUMN "piiLevel" "PiiLevel" NOT NULL DEFAULT 'NONE';
CREATE INDEX "Entity_tenantId_idx" ON "Entity"("tenantId");
CREATE INDEX "Entity_piiLevel_idx" ON "Entity"("piiLevel");
ALTER TABLE "Entity" ADD CONSTRAINT "Entity_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Entity" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "slug" = 'default' LIMIT 1)
WHERE "tenantId" IS NULL;

ALTER TABLE "Source" ADD COLUMN "tenantId" BIGINT;
CREATE INDEX "Source_tenantId_idx" ON "Source"("tenantId");
ALTER TABLE "Source" ADD CONSTRAINT "Source_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Source" SET "tenantId" = (SELECT "id" FROM "Tenant" WHERE "slug" = 'default' LIMIT 1)
WHERE "tenantId" IS NULL;
