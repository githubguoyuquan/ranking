# API 网关与鉴权（生产）

## 默认行为

| 项 | 生产 | 本地开发 |
|----|------|----------|
| `API_AUTH_REQUIRED` | **默认开启**（仅显式 `=false` 关闭） | `.env` 设 `API_AUTH_REQUIRED=false` |
| `/v1` GET | 需 **read / write / admin** scope | 同上（关闭鉴权时跳过） |
| `/v1` POST/PATCH/DELETE | 需 **write / admin** scope | 同上 |
| `/admin/*` | 需 **admin** scope | `API_ADMIN_OPEN` 仅在鉴权关闭时生效 |
| 公开路径 | `/health`、`/health/*`、`/v1/realtime/stream` | 同左 |

实现：`src/compliance/api-key.guard.ts`（全局 `APP_GUARD`）。

## 密钥分工

| 用途 | Scope | 存放 |
|------|-------|------|
| C 端只读 | `read` | `NEXT_PUBLIC_READ_API_KEY`（浏览器） |
| 运营台 | `admin` | 仅服务端 / 内网，**勿**暴露到 `NEXT_PUBLIC_*` |
| DR / scale 脚本 | `admin` | K8s Secret `RANKING_ADMIN_API_KEY`、GHA secrets |
| 写入排行/策略 | `write` 或 `admin` | 后端集成 |

创建密钥：`POST /admin/compliance/api-keys`（管理台 `/console/compliance`）。

## Ingress 网关（Helm）

`values-production.yaml` 已配置 nginx Ingress 路径分流：

| 路径 | 后端 |
|------|------|
| `/` | Next.js Web |
| `/v1` | API |
| `/admin` | API |
| `/health` | API |

推荐 annotations（已写入 values-production）：

- `limit-rps` / `limit-rpm` — 边缘限流
- `ssl-redirect` — 强制 HTTPS
- `proxy-body-size` — 请求体上限

### 限制 `/admin` 暴露面

若 Web 与 API 同域公网可达，建议二选一：

1. **独立 admin 域名** — `admin.ranking.example.com` → API，Ingress 仅内网/VPN CIDR
2. **nginx whitelist** — 在 `ingress.annotations` 增加：

```yaml
nginx.ingress.kubernetes.io/server-snippet: |
  location ^~ /admin/ {
    allow 10.0.0.0/8;
    deny all;
    proxy_pass http://upstream_balancer;
  }
```

（按集群 CIDR 调整；生产 values 中通过 `ingress.adminAllowCidrs` 扩展时可模板化。）

## 与 AWS 接线

- External Secrets 注入 `RANKING_ADMIN_API_KEY` 供 CronJob / 脚本
- `API_AUTH_REQUIRED=true` 在 `values-aws-production.yaml` 固定开启
- DR / scale CronJob 使用 admin key 集群内调用 `http://ranking-ranking-api:3000`

## 相关

- [AWS_PRODUCTION_WIRING.md](./AWS_PRODUCTION_WIRING.md)
- [ALERT_ONCALL_RUNBOOK.md](./ALERT_ONCALL_RUNBOOK.md)
