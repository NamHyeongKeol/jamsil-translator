'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/trpc'
import { Loader2 } from 'lucide-react'

export default function Home() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [mounted, setMounted] = useState(false)

  const { data: users, refetch: refetchUsers } = api.user.getAll.useQuery(undefined, {
    enabled: mounted
  })
  const { data: posts, refetch: refetchPosts } = api.post.getAll.useQuery(undefined, {
    enabled: mounted
  })

  useEffect(() => {
    setMounted(true)
  }, [])

  const createUser = api.user.create.useMutation({
    onSuccess: () => {
      refetchUsers()
      setName('')
      setEmail('')
    },
  })

  const createPost = api.post.create.useMutation({
    onSuccess: () => {
      refetchPosts()
      setTitle('')
      setContent('')
    },
  })

  const handleCreateUser = () => {
    if (name && email) {
      createUser.mutate({ name, email })
    }
  }

  const handleCreatePost = () => {
    if (title && users && users[0]) {
      createPost.mutate({
        title,
        content: content || undefined,
        authorId: users[0].id
      })
    }
  }

  if (!mounted) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-responsive">
      <div className="mx-auto max-w-md space-y-responsive">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Jamsil Translator</h1>
          <p className="text-gray-600 mt-2">모바일 친화적인 웹 애플리케이션</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">새 사용자 추가</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">이름</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름을 입력하세요"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="이메일을 입력하세요"
                className="mt-1"
              />
            </div>
            <Button
              onClick={handleCreateUser}
              disabled={createUser.isPending || !name || !email}
              className="w-full"
            >
              {createUser.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              사용자 추가
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">새 포스트 작성</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="title">제목</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="제목을 입력하세요"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="content">내용</Label>
              <Input
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="내용을 입력하세요 (선택사항)"
                className="mt-1"
              />
            </div>
            <Button
              onClick={handleCreatePost}
              disabled={createPost.isPending || !title || !users?.length}
              className="w-full"
            >
              {createPost.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              포스트 작성
            </Button>
            {!users?.length && (
              <p className="text-sm text-gray-500 text-center">
                포스트를 작성하려면 먼저 사용자를 추가하세요
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">사용자 목록</CardTitle>
          </CardHeader>
          <CardContent>
            {users?.length ? (
              <div className="space-y-3">
                {users.map((user) => (
                  <div key={user.id} className="bg-gray-50 p-3 rounded-lg">
                    <h3 className="font-medium">{user.name}</h3>
                    <p className="text-sm text-gray-600">{user.email}</p>
                    <p className="text-xs text-gray-500">
                      포스트 수: {user.posts.length}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center">사용자가 없습니다</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">최근 포스트</CardTitle>
          </CardHeader>
          <CardContent>
            {posts?.length ? (
              <div className="space-y-3">
                {posts.map((post) => (
                  <div key={post.id} className="bg-gray-50 p-3 rounded-lg">
                    <h3 className="font-medium">{post.title}</h3>
                    {post.content && (
                      <p className="text-sm text-gray-600 mt-1">{post.content}</p>
                    )}
                    <p className="text-xs text-gray-500 mt-2">
                      작성자: {post.author.name}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 text-center">포스트가 없습니다</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}