import { z } from 'zod'
import { router, publicProcedure } from '../trpc'

export const postRouter = router({
  getAll: publicProcedure.query(async ({ ctx }) => {
    return ctx.prisma.post.findMany({
      include: {
        author: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    })
  }),

  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.post.findUnique({
        where: { id: input.id },
        include: {
          author: true,
        },
      })
    }),

  create: publicProcedure
    .input(
      z.object({
        title: z.string(),
        content: z.string().optional(),
        authorId: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.post.create({
        data: input,
      })
    }),
})