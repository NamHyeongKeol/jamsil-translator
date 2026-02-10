-- AlterTable
ALTER TABLE "Subscriber" ADD COLUMN     "fullUrl" TEXT,
ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "pageLanguage" TEXT,
ADD COLUMN     "pathname" TEXT,
ADD COLUMN     "platform" TEXT,
ADD COLUMN     "queryParams" TEXT,
ADD COLUMN     "referrer" TEXT,
ADD COLUMN     "screenHeight" INTEGER,
ADD COLUMN     "screenWidth" INTEGER,
ADD COLUMN     "timezone" TEXT,
ADD COLUMN     "userAgent" TEXT;

-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "language" TEXT,
    "pageLanguage" TEXT,
    "referrer" TEXT,
    "fullUrl" TEXT,
    "queryParams" TEXT,
    "pathname" TEXT,
    "screenWidth" INTEGER,
    "screenHeight" INTEGER,
    "timezone" TEXT,
    "platform" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventLog_eventType_idx" ON "EventLog"("eventType");

-- CreateIndex
CREATE INDEX "EventLog_createdAt_idx" ON "EventLog"("createdAt");

-- CreateIndex
CREATE INDEX "EventLog_ipAddress_idx" ON "EventLog"("ipAddress");
