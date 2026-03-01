import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      externalUserId?: string | null;
    };
  }

  interface User {
    externalUserId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    externalUserId?: string;
  }
}
