# DuoFit Intake

手机优先的静态 PWA：录入日期、餐次、食品、重量、生熟状态、是否偏油/涮水和自由备注。

## 当前状态

- GitHub Pages 可直接托管，不需要构建命令。
- 未连接 API 前，记录仅作为本机草稿保存在浏览器 localStorage 中，**不是云端备份**。
- 在“API 连接设置”填入 Neon Function 的 HTTPS 根地址后，应用向 `POST {API_URL}/api/submissions` 提交 JSON。
- API 尚未部署；仅填写 URL 不意味着已经连通。
- 不保存正式 Neon `meals` / `intake_items`，不做营养计算。
- 新增“营养计划”分页：预留 `GET /api/nutrition/overview?date=...&day_class=...`，计划版本、运动日分类、能量及四项营养素目标都必须由 API 返回；未连接前不展示猜测数值。
- 新增“身体与运动”分页：晨重、腰围先作为本机草稿保存在 localStorage；截图先保存在 IndexedDB，API 认证配置完成后可同步到私有对象存储及待处理表。**这些信息不会直接写入正式运动或测量表**。清除未同步的浏览器数据可能导致丢失。
- 后端 Neon Function 已部署在 `https://br-divine-king-bdg94005-duofitintake.compute.c-8.us-east-2.aws.neon.tech`。首次使用通过 PWA 的“申请设备授权”登记本机生成的凭据，管理员在 Neon 数据库核实设备后才批准，不需要共享 API Key。
- 后端仅使用 `duofit_intake_api` 受限角色写入 `intake_stage`，对正式 `meals` 等表只有读取权限。所有正式入库仍需要用户明确确认。

## 提交协议（待实现的 Neon Function）

```json
{
  "id": "uuid-stable-for-retry",
  "person": "partner",
  "date": "2026-11-19",
  "meal": "lunch",
  "items": [{ "name": "鸡小胸", "weight_g": 150, "weight_kind": "raw", "oily": false, "rinsed": true, "note": "涮水后吃" }],
  "submitted_at": "2026-11-19T04:00:00.000Z"
}
```

服务端必须验证调用者身份、约束 person/字段值、以 `id` 幂等写入待处理表，并提供适合 GitHub Pages 来源的 CORS 配置。

## GitHub Pages

在仓库 `Settings → Pages → Build and deployment` 选择 `GitHub Actions`。推送到 `main` 会触发部署。

本地开发可使用 `python3 -m http.server 8080`，访问 `http://localhost:8080/`。

## Neon Function

后端源文件位于 `function/`。部署版本使用 `esbuild` 打包成 Node.js 24 的 `index.mjs`，并上传到 Neon Function slug `duofitintake`。

`DUOFIT_DB_PASSWORD` 是仅用于 `intake_stage` 的数据库角色口令，已作为服务端环境变量保存，**不能加入前端、GitHub 仓库或日志**。每个设备拥有独立的随机凭据，服务端只保存 SHA-256 哈希。`intake_stage.device_requests` 保存待批准设备，只有数据库管理端有权限向 `public.duofit_approved_devices` 添加批准记录。截图保存于私有 `duofit-activity-images` bucket。

路由：

- `GET /health`：公开健康检查（不暴露个人数据）
- `POST /api/device/register`：提交设备绑定申请，未获得业务权限
- `GET /api/device/status?id=...`：以该设备凭据查询批准状态
- `POST /api/submissions`：饮食原始投稿
- `POST /api/measurements`：身体测量原始投稿
- `POST /api/activity-images`：上传单张截图（multipart）
- `POST /api/activities`：运动原始投稿及截图 key
- `GET /api/submissions?kind=intake|measurement|activity`：获取待审核投稿
- `GET /api/nutrition/overview?date=YYYY-MM-DD&day_class=...`：读取生效计划、指定活动方案和已确认摄入

除健康检查外，所有路由均要求 `Authorization: Bearer <token>`。只有提交接口允许来自本仓库 GitHub Pages 页面的浏览器跨域调用，后端还会检查 POST 请求的 `Origin`。

注意：`day_class=actual` 目前**不会自动推断**运动分类。按日实际运动的动态营养目标需要在进一步实现活动规则匹配后才能展示；用户可以在页面手动选择具体运动日方案进行比较。摄入进度只聚合已结构化且 confirmed 的摄入明细，其他历史内容仍可能缺失。
