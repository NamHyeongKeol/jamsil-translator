-- CreateTable
CREATE TABLE "app"."native_auth_pending_results" (
    "request_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider" TEXT,
    "callback_url" TEXT NOT NULL,
    "bridge_token" TEXT,
    "message" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "native_auth_pending_results_pkey" PRIMARY KEY ("request_id")
);

-- CreateIndex
CREATE INDEX "native_auth_pending_results_expires_at_idx" ON "app"."native_auth_pending_results"("expires_at");
