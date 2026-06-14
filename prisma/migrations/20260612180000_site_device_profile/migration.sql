CREATE TABLE "site_device_profiles" (
    "id" TEXT NOT NULL,
    "deviceId" VARCHAR(64) NOT NULL,
    "tier" VARCHAR(32) NOT NULL DEFAULT 'free',
    "recentTopics" JSONB NOT NULL DEFAULT '[]',
    "watchlist" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "site_device_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "site_device_profiles_deviceId_key" ON "site_device_profiles"("deviceId");
CREATE INDEX "site_device_profiles_updatedAt_idx" ON "site_device_profiles"("updatedAt");
