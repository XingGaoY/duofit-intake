# DuoFit Intake

手机优先的静态 PWA：录入日期、餐次、食品、重量、生熟状态、是否偏油/涮水和自由备注。

## 当前状态

- GitHub Pages 可直接托管，不需要构建命令。
- 未连接 API 前，记录仅作为本机草稿保存在浏览器 localStorage 中，**不是云端备份**。
- 在“API 连接设置”填入 Neon Function 的 HTTPS 根地址后，应用向 `POST {API_URL}/api/submissions` 提交 JSON。
- API 尚未部署；仅填写 URL 不意味着已经连通。
- 不保存正式 Neon `meals` / `intake_items`，不做营养计算。
- 新增“营养计划”分页：预留 `GET /api/nutrition/overview?date=...&day_class=...`，计划版本、运动日分类、能量及四项营养素目标都必须由 API 返回；未连接前不展示猜测数值。
- 新增“身体与运动”分页：晨重、腰围作为本机草稿保存在 localStorage；截图保存在当前浏览器的 IndexedDB 中。**它们尚未上传 API，更没有写入生产 Neon**。清除浏览器数据可能导致丢失。

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

服务端必须验证调用者身份、约束 person/字段值、以 `id` 幂等写入待处理表，并提供适合 GitHub Pages 来源的 CORS 配置。口令目前只作为联调可选项；正式发布给他人使用前应接入可靠认证，不应在公开代码中硬编码任何凭据。

## GitHub Pages

在仓库 `Settings → Pages → Build and deployment` 选择 `GitHub Actions`。推送到 `main` 会触发部署。

本地开发可使用 `python3 -m http.server 8080`，访问 `http://localhost:8080/`。
