# Devbox / 服务器部署说明（前端 + 本地 BFF）

## 架构

- **前端**：Vite 构建产物在 `out/`。
- **后端**：`server/index.mjs`（Express），提供 `/api/knowledge-extraction/*`，会话落在 `server/data/`。若配置 **Sealos 对象存储**（`OSS_*` 环境变量），上传文件写入 **存储桶**；否则暂存 `server/uploads/`。
- **Dify**：导入 `dify/ke-01-source-anchor.dsl.yml`，配置模型后发布；将 **Workflow API Key** 写入环境变量 `KE_ANCHOR_API_KEY`，`DIFY_BASE_URL` 指向可访问的 Dify `/v1` 根路径。

## 本地开发（Windows / Mac）

1. 复制 `.env.example` 为 `.env.local`，至少设置 `VITE_API_BASE=/api`。
2. 根目录创建 `.env`（与 `dotenv` 加载一致），配置 `KE_ANCHOR_API_KEY`（可选，不配则返回模拟锚定包）。
3. 安装依赖：`npm install`。
4. 同时启动 API 与前端：`npm run dev:full`（或两个终端分别 `npm run server` 与 `npm run dev`）。
5. 浏览器访问控制台打印的 Vite 地址（默认端口见 `vite.config.ts`）。

## Devbox 上部署（单进程托管静态站 + API）

1. 在 Devbox 中拉取代码，执行 `npm install`。
2. 在平台环境变量中配置：`KE_ANCHOR_API_KEY`、`DIFY_BASE_URL`、`SERVER_PORT`（与平台映射端口一致）。若使用对象存储，增加 `OSS_ENDPOINT`、`OSS_ACCESS_KEY_ID`、`OSS_SECRET_ACCESS_KEY`、`OSS_BUCKET`（**Secret 勿提交 Git**）。与 Sealos 同集群时 `OSS_ENDPOINT` 可用控制台 **Internal** 内网地址。
3. 构建并启动：

```bash
npm run build
npm run start:app
```

`start:app` 会设置 `NODE_ENV=production` 与 `SERVE_STATIC=1`，由 **同一 Node 进程** 提供 `out/` 静态资源与 `/api` 接口（见 `server/index.mjs`）。

4. 将 Sealos / Devbox **对外端口** 指向 `SERVER_PORT`（默认 `8787`，若平台注入 `PORT` 可改脚本使用 `process.env.PORT`）。

## 生产建议

- 会话表建议换为 **托管数据库**；上传已支持 **对象存储**，未配置 `OSS_*` 时仍用本地 `server/uploads/`。
- `KE_ANCHOR_API_KEY` 仅放服务端，勿写入前端构建环境。
