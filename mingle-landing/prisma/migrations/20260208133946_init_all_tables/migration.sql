-- CreateTable
CREATE TABLE "Subscriber" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ButtonClick" (
    "id" TEXT NOT NULL,
    "buttonType" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "language" TEXT,
    "referrer" TEXT,
    "screenWidth" INTEGER,
    "screenHeight" INTEGER,
    "timezone" TEXT,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ButtonClick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DemoConversation" (
    "id" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "utterances" JSONB NOT NULL,
    "selectedLanguages" TEXT[],
    "usageSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visitor" (
    "id" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "language" TEXT,
    "pageLanguage" TEXT,
    "referrer" TEXT,
    "screenWidth" INTEGER,
    "screenHeight" INTEGER,
    "timezone" TEXT,
    "platform" TEXT,
    "pathname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscriber_email_key" ON "Subscriber"("email");
