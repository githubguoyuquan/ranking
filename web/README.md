# Ranking 管理前端

本目录为 **Next.js** 管理台，对接仓库根目录的 Nest API。

- **环境**：`cp .env.example .env.local`，默认 `NEXT_PUBLIC_API_URL=http://localhost:3000`（与 `src/lib/api.ts` 的 `DEFAULT_PUBLIC_API_URL` 一致）
- **启动**：`npm install` → `npm run dev`（默认 **http://localhost:3001**）
- **静态检查**：`npm run lint`、**`npm run typecheck`**；仓库根 **`npm run lint:all`**（Nest + web lint + web TS）。亦可仅 **`npm run lint:web`**。
- **API 路径**：相对路径在 **`src/lib/nest-api-paths.ts`**（`/v1/*`）与 **`src/lib/backend-api-paths.ts`**（`/health`、`/admin/*`）；绝对 URL 由 **`nest-api-urls.ts`**、**`backend-api-urls.ts`**（经 **`apiUrl()`**）拼接。
- **说明**：功能清单、健康检查与各 API 行为见仓库根目录 [**README.md**](../README.md) 中「Web 管理端」与相关章节。
