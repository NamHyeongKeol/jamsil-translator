FROM node:20-slim

WORKDIR /app

# pnpm 설치
RUN npm install -g pnpm

# 의존성 먼저 복사 (캐시 활용)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --ignore-scripts --frozen-lockfile

# 소스 복사
COPY stt-server.ts segmentation-strategy.ts tsconfig.json ./

# 빌드
RUN pnpm build

EXPOSE 3001

CMD ["node", "dist/stt-server.js"]
