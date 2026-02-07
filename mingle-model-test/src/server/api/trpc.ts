import { initTRPC } from '@trpc/server'
import { type CreateNextContextOptions } from '@trpc/server/adapters/next'
import { prisma } from '@/lib/prisma'

export const createTRPCContext = (opts: CreateNextContextOptions) => {
  return {
    prisma,
  }
}

const t = initTRPC.context<typeof createTRPCContext>().create()

export const router = t.router
export const publicProcedure = t.procedure