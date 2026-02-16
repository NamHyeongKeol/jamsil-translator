import * as PrismaClientPackage from "@prisma/client";

type PrismaClientLike = import("@prisma/client").PrismaClient;

type PrismaClientConstructor = new (options?: {
  datasources?: {
    db?: {
      url?: string;
    };
  };
}) => PrismaClientLike;

const PrismaClientCtor = (PrismaClientPackage as unknown as {
  PrismaClient?: PrismaClientConstructor;
}).PrismaClient;

if (!PrismaClientCtor) {
  throw new Error("PrismaClient is not available. Make sure prisma generate runs during build.");
}
const ResolvedPrismaClientCtor: PrismaClientConstructor = PrismaClientCtor;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientLike | undefined;
};

function prismaClientSingleton() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    return new ResolvedPrismaClientCtor({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
    });
  }
  return new ResolvedPrismaClientCtor();
}

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
