import { router } from './trpc'
import { postRouter } from './routers/post'
import { userRouter } from './routers/user'

export const appRouter = router({
  post: postRouter,
  user: userRouter,
})

export type AppRouter = typeof appRouter