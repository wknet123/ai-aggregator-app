# 外部角色库集成 OmniWeaver — 可操作性分析与实施方案

> 目标：把一个**外部角色库**接入 OmniWeaver「要素配置」，作为**公共资源供展示浏览**；用户选定某个角色后，**抓取并落盘到该项目的本地存储空间（MinIO）**，最终可在**分镜拆分**中引用。
>
> 样例来源：`https://app.tapnow.ai/canvas/b153a177-870a-4047-8923-2b7d8b18f5de`（TapNow「Agentic Creative Canvas」）。
>
> 结论摘要：**落盘与引用链路我方已基本就绪，缺的是"抓取入口 + 外部库浏览 UI + 安全防护"。但样例 URL 本身需要登录鉴权、无法匿名读取**，因此"直接把该链接当公共资源浏览"这条路不成立，需按本文 §2 的可操作路径调整。

---

## 1. 外部 URL 可访问性核实（实测）

对样例链接做了实测探测，结论明确：

| 探测项 | 结果 |
|---|---|
| 页面性质 | 客户端 SPA（React + fabric.js + three.js + webav），Google Frontend 托管的静态 HTML 外壳，真实数据由 JS 调后端 API 拉取 |
| 页面标题 | `TapNow \| Your Agentic Creative Canvas` |
| 真实数据 API | `GET https://app.tapnow.ai/api/canvas/{uuid}` |
| **鉴权状态** | **`401 {"code":110003,"message":"unauthorized"}`** —— **必须登录 TapNow 账号** |
| 免鉴权分享/公开变体 | 均不可用：`/api/canvas/{uuid}/share` → 401；`/api/canvas/share/{uuid}` → 401；`?share=true` → 401；`/api/public/canvas/{uuid}` → 404（公开命名空间存在，但该 canvas 未公开） |
| 其它返回 200 的路径 | 只是 SPA 的 HTML 外壳（前端路由回退），**不含数据** |
| 资产 CDN | 图片资源域 `files.tapnow.media` / `fe-assets.tapnow.media`（CDN，但具体图片 URL 藏在需鉴权的 canvas 数据里，拿不到 URL 就下不到图） |

**关键判断：**

1. **该 URL 不是公开资源**——匿名（无 TapNow 登录态）拿不到任何角色数据或图片 URL。把它"作为公共资源展示浏览"的前提（免登录读取）**不成立**。
2. TapNow **无公开文档化的开放 API**（`docs.tapnow.ai` 存在但为产品文档，非开发者 API）。
3. 因此不能简单地"服务端代理抓取这个链接"来展示——服务端同样是匿名身份，同样吃 401。

> 换言之：技术链路（抓取→落盘→引用）我方能做；**但数据源的合法、稳定获取是本集成的真正瓶颈**，取决于我们以何种方式取得对该外部库的读取授权。

---

## 2. 可操作性分析：三条路径

既然样例源需要鉴权且无开放 API，"外部角色库集成"有三种现实可行的形态，按**可控性 / 合规性 / 工作量**权衡如下。

### 路径 A ⭐（推荐）：自建「平台公共角色库」，外部素材离线导入

**做法**：不实时对接 TapNow，而是建立**我方自己的公共角色库**（一张公共资源表 + MinIO 公共目录）。运营/管理员把授权可用的外部角色（含 TapNow 上我方账号导出的、或其它有版权的素材）**离线导入**到平台公共库；用户在要素配置里浏览的是**我方托管的公共库**，选定即从我方 MinIO 公共目录复制到项目素材目录。

- **可访问性**：100% 可控（数据在我方 MinIO），无 401、无外部依赖抖动。
- **合规性**：素材版权在导入环节把关，最干净。
- **展示浏览**：真正的"公共资源"，所有租户可见、可检索、可分页。
- **落盘**：选定 → 后端 MinIO **对象间复制**（`get_object_bytes` → `_upload_asset_image`），比抓外部 URL 更快更稳，且复用 `add_asset_images` 的 flux 分支同构逻辑。
- **代价**：需要一个公共库的建库 + 运营导入流程；不是"实时镜像某个外部链接"。

### 路径 B：通用「外部 URL 导入」——用户自带可公开访问的图片 URL

**做法**：不特定对接 TapNow，而是提供一个通用能力——用户/运营在要素配置里**粘贴一个或多个可公开访问的图片直链 URL**（例如某个真正公开的图床、我方账号从 TapNow 导出的公开图 URL），后端抓取落盘为项目素材。

- **可访问性**：仅对**真正公开**的图片 URL 有效；对 TapNow 这类需鉴权的 canvas **无效**（拿不到图片直链）。
- **合规性**：URL 由用户提供，需加 SSRF/域名白名单/大小限制，且需用户对版权负责。
- **工作量最小**：后端仅需在 `add_asset_images` 增一个 `image_urls` 分支（见 §4）。
- **定位**：作为路径 A 的补充入口，不是主力。

### 路径 C：实时对接外部库 API（需授权/凭据）

**做法**：若未来与 TapNow（或其它角色库）达成合作、拿到 **API Key / OAuth / 我方托管的服务账号 Cookie**，则后端以该凭据代理调用其 `/api/canvas/*`，把角色列表与图片实时拉进来展示浏览。

- **可访问性**：可行，但**强依赖对方授权**与接口稳定性（对方无公开 API 契约，随时可能变）。
- **合规性/安全**：凭据需安全托管（不落前端）；受对方 ToS 约束。
- **工作量最大 + 外部依赖风险最高**；样例 URL 现状下**暂不具备条件**。

### 推荐

**主线走路径 A（自建公共角色库 + 离线导入），并顺带实现路径 B 的通用 URL 导入作为补充入口。** 路径 C 待拿到正式授权后作为 v2 增强。理由：A 把"可访问性/合规性/稳定性"三个最大风险一次性消除，且完美契合用户诉求中的"**作为要素配置公共资源，供展示浏览**"——公共库本就该是我方可控的资源，而非一个会 401 的外部链接。

> 下文 §3~§6 的技术设计以**路径 A 为主、内建路径 B 的抓取能力**（二者共用同一套落盘链路，仅"取字节"的来源不同：A 取自我方 MinIO 公共对象，B 取自外部 http URL）。

---

## 3. 现有链路核实（决定复用与新增）

已核实我方代码库现状（关键文件:行号）：

**✅ 可直接复用（已就绪）**

| 能力 | 位置 |
|---|---|
| 素材落盘链 | `_upload_asset_image()` `project_assets.py:125` → `storage.project_asset_key()` `storage.py:219`（key: `users/{uid}/drama/{project_id}/assets/{asset_id}/{filename}`）→ `storage.upload_bytes()` `storage.py:90` |
| 外部 URL→bytes 下载原语 | `GatewayClient.fetch_bytes(url, timeout)` `gateway/client.py:320`（httpx，支持 http/data URL，有 `raise_for_status`）；单例 `get_gateway_client()` `:848`；先例 `media_studio.py:273` |
| 内部对象复制骨架 | `add_asset_images` 的 flux 分支 `project_assets.py:309-327`（取字节→`_upload_asset_image`→建 `ProjectAssetImage`）——路径 A/B 皆同构 |
| 引用侧（无需改动） | `AssetPickerModal` 产出 `{ key(=image_path), label, desc, name, assetId, assetType }` `AssetPickerModal.tsx:23,75`；分镜以 `shots[].images[].assetId` / 整集 `assets[].assetId` 存入 `DramaProject.episodes_data`（`project_assets.py:81-108` 反证）。**新素材落盘后天然带 `image_path`，即可被引用** |

**❌ 需新增**

1. 后端**抓取入口**：现 `create_asset`/`add_asset_images` 只收 `UploadFile`+`flux_task_id`，无 URL / 无"从公共库复制"分支。
2. **公共角色库**：数据模型 + 浏览/检索 API + 运营导入（路径 A）。
3. **content-type/扩展名判定**：外部 URL 常无扩展名，`_upload_asset_image` 现默认 png（`:129`），需从响应头 `Content-Type` 推断。
4. **前端外部/公共库浏览 UI**：现 `ImagePickerModal`（`AssetConfigPanel.tsx:517`）只覆盖"我的作品/公共发现"，无外部/公共角色库组件。
5. **SSRF/安全防护**：`fetch_bytes` 仅有 timeout，无域名白名单/大小上限。
6. **溯源字段**（可选）：`ProjectAsset`（`models/project_asset.py:15`）无"来源/原始 URL/外部 ID"列。

---

## 4. 后端设计

### 4.1 公共角色库模型（路径 A 新增）

新增 `public_characters` 表（平台级公共资源，跨租户只读展示）：

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` PK / `char_id` uuid | | |
| `name` | str | 角色名 |
| `description` | str | 简介/人设 |
| `category` / `tags` | str / JSON | 分类、标签（供检索筛选） |
| `cover_path` | str | 封面 MinIO key（`public/characters/...`） |
| `image_paths` | JSON | 多图 MinIO key 列表 |
| `source` | str | 来源标注（如 `tapnow` / `manual`） |
| `source_ref` | str | 外部原始 id/url（溯源，可空） |
| `is_active` `sort_order` | | 上下架、排序 |
| `created_at/updated_at` | ts | |

- MinIO 公共目录：复用 `storage.public_key(...)`（现有 `public/` 前缀，`is_minio_key` 已识别），如 `public/characters/{char_id}/{filename}`。
- 运营导入：一个管理员端点/脚本，把授权素材（本地文件或我方账号导出的图）上传到公共目录并建 `public_characters` 记录。

### 4.2 API 端点

新增 router `public_characters.py`（前缀 `/api/v1/public-characters`）：

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/` | 登录用户 | 分页浏览公共角色库（`?q=&category=&page=`）——**供展示浏览** |
| GET | `/{char_id}` | 登录用户 | 角色详情（多图） |
| GET | `/{char_id}/images/{idx}/file` | 登录用户 | 流式返回图片（复用 `static_media` 的 MinIO 流式代理，**不用 presigned/RedirectResponse**，遵循 CLAUDE.md 约束） |
| POST | `/` `/{id}` DELETE | **管理员** | 运营导入/维护公共角色（`is_admin` 门控） |

**选定落盘**——在 `project_assets.py` 扩展 `create_asset` 或新增端点：

```
POST /api/v1/project-assets/import
body: {
  project_id, asset_type='character',
  from_public_char_id?: str,      # 路径 A：从公共库复制
  image_urls?: List[str],         # 路径 B：从外部公开 URL 抓取
  name?, description?             # 缺省时取公共库角色的 name/description
}
```

内部逻辑（复用 `add_asset_images` 骨架）：

```
校验项目归属（_get_owned_asset / 项目 owner 校验）
若 from_public_char_id:
    读 public_characters → 逐张 storage.get_object_bytes(public_key) → _upload_asset_image(...)
若 image_urls:
    逐个 URL:
        安全校验（§4.4）
        data, ct = await gateway.fetch_bytes(url)          # 复用现有下载原语
        ext = ext_from_content_type(ct) or ext_from_url(url) or 'png'   # §4.3
        _upload_asset_image(storage, data, f"import.{ext}", uid, project_id, asset_id, order)
建 ProjectAsset + ProjectAssetImage（首图 is_cover=1）
记 source/source_ref（若扩展了溯源字段）
commit → 返回 ProjectAssetRecord（前端立即可在要素配置看到，并可被分镜引用）
```

- **批量选定**：前端可对多个选中角色循环调用，或提供 `POST /import/batch` 接收 `items[]` 一次落盘多个 `ProjectAsset`（推荐，减少往返）。
- **计费**：纯复制/抓取不走生成模型，**不扣积分**（仅存储成本）。如需限额，可用素材数量上限而非积分。

### 4.3 content-type / 扩展名判定（修 §3-3）

新增小工具（`storage.py` 或 `project_assets.py`）：

```
ext_from_content_type("image/jpeg") -> "jpg" / "image/png"->"png" / "image/webp"->"webp" ...
回退：从 URL path 尾部取扩展名；再回退 "png"
```

`_upload_asset_image` 增一个可选 `content_type` 入参，优先用抓取响应头的真实 CT，避免统一 png 与真实字节不符。

### 4.4 安全防护（修 §3-5，路径 B 必须）

对 `image_urls` 抓取加固：

- **协议白名单**：仅 `http/https`（`data:` 视需要，谨慎）。
- **SSRF 防护**：拒绝内网/环回/元数据地址（`127.0.0.0/8`、`10/172.16/192.168`、`169.254.169.254`、`::1` 等）；解析 DNS 后校验目标 IP。
- **（可选）域名白名单**：如只允许 `files.tapnow.media`、我方 CDN 等可信源。
- **大小/超时**：`fetch_bytes` 增 `max_bytes`（如 ≤10MB）+ 合理 timeout；超限中断。
- **类型校验**：响应 CT 必须在 `ALLOWED_IMAGE_TYPES`（复用现有常量），否则拒绝。
- **数量上限**：单次 import URL/角色数量上限，防滥用。

---

## 5. 前端设计

### 5.1 要素配置内新增「公共角色库」入口

在 `AssetConfigPanel.tsx` 的角色（character）子页签，新增一个来源标签/按钮 **「公共角色库」**，与现有"本地上传 / 文生图 / 从作品选择"并列，打开 `PublicCharacterPicker`。

### 5.2 新组件 `PublicCharacterPicker`（供展示浏览 + 选定）

- 参考现有 `ImagePickerModal`（`AssetConfigPanel.tsx:517`）与模板卡片网格（`effectsData.ts` 系列）风格。
- 顶部搜索框 + 分类/标签筛选；卡片网格（封面 + 名称 + 简介），分页/滚动加载。
- 数据源：`publicCharacterService.list({ q, category, page })`（新增 service）。
- 多选：勾选一个或多个角色 → 「导入到本项目」→ 调 `projectAssetService.importFromPublic({ project_id, char_ids })`（或批量端点）。
- 导入进度：复用现有 `onUploadProgress`/加载态；完成后刷新 `listAssets`，新角色立即出现在要素配置，可被分镜引用。

### 5.3（路径 B）「外部 URL 导入」小面板

在同一入口下加"粘贴图片 URL 导入"文本框（多行，每行一个 URL）→ `projectAssetService.importFromUrls({ project_id, name, image_urls })`。带前端基本校验（http/https、条数上限）与错误提示（后端 401/超时/类型不符的失败逐条回显）。

### 5.4 service 新增

`project-asset.service.ts` 增：
- `importFromPublic({ project_id, char_ids }) → ProjectAssetRecord[]`
- `importFromUrls({ project_id, name?, asset_type, image_urls }) → ProjectAssetRecord`

新增 `public-character.service.ts`：
- `list({ q?, category?, page? }) → { items: PublicCharacter[], total }`
- `get(charId)`、`imageUrl(charId, idx)`

### 5.5 引用链路（无需改动）

落盘后的公共角色即普通 `ProjectAsset`（character 类型，带 `image_path`），**分镜拆分中通过现有 `AssetPickerModal` 直接引用**（产出 `{key, assetId, assetType, ...}` 进入 `episodes_data` → 生成时按 key 从 MinIO 取字节喂模型）。这条链路完全复用，**零改动**。

---

## 6. 端到端流程（路径 A）

```
运营：把授权角色素材导入平台公共库（public/characters/... + public_characters 记录）
  ↓
用户（要素配置 · 角色页签）：点「公共角色库」→ 浏览/搜索/筛选（GET /public-characters）
  ↓ 选定 1..N 个角色
POST /project-assets/import { project_id, from_public_char_id[] }
  ↓ 后端：MinIO 对象复制 → users/{uid}/drama/{project_id}/assets/{asset_id}/...
  ↓ 建 ProjectAsset(character) + ProjectAssetImage(首图 is_cover)
要素配置列表刷新 → 新角色出现（已落盘到本项目本地存储）
  ↓
分镜拆分：AssetPickerModal 选该角色作参考图 → 存入 episodes_data.shots[].images[].assetId
  ↓
镜头生成：按 image_path 从 MinIO 取字节喂入生成模型 → 成片
```

（路径 B 仅第 2~3 步不同：来源是外部公开 URL，后端 `fetch_bytes` + 安全校验后落盘，其余一致。）

---

## 7. 工作量与分期

| 期次 | 范围 | 主要改动 |
|---|---|---|
| **P0 · 通用 URL 导入（路径 B，最小可用）** | 后端 `image_urls` 抓取落盘分支 + 安全防护 + CT 判定；前端"粘贴 URL 导入"面板 | `project_assets.py`（新分支，复用 `fetch_bytes`+`_upload_asset_image`）、安全工具、`project-asset.service.ts` |
| **P1 · 公共角色库（路径 A，主线）** | `public_characters` 模型/迁移、浏览/详情/流式取图 API、管理员导入端点、`import(from_public_char_id)`、前端 `PublicCharacterPicker` + service | 新 `public_characters.py` router、`public-character.service.ts`、`PublicCharacterPicker.tsx`、`AssetConfigPanel` 接入 |
| **P2 · 实时对接（路径 C，视授权）** | 拿到 TapNow/第三方正式授权后，后端凭据代理其 API，实时浏览+抓取 | 新 integration 客户端 + 凭据托管；依赖外部授权，暂缓 |

---

## 8. 结论与建议

1. **样例 TapNow 链接需登录鉴权、无免鉴权/公开变体、无开放 API** —— 实测确认，**不能作为匿名公共资源直接浏览/抓取**。
2. 我方**落盘与分镜引用链路已就绪**（`fetch_bytes` + `_upload_asset_image` + `project_asset_key` + `AssetPickerModal`），真正要补的是**抓取入口、公共库、浏览 UI、安全防护**。
3. **推荐主线：自建平台公共角色库（路径 A）+ 通用 URL 导入（路径 B）**。这既满足"公共资源展示浏览 → 选定 → 落盘本项目 → 分镜引用"的完整诉求，又规避了外部源鉴权/合规/稳定性三大风险。
4. **路径 C（实时对接 TapNow）需先取得正式授权**（API Key/服务账号），且对方无公开 API 契约、接口易变，建议作为拿到授权后的 v2 增强，不作为首期依赖。

**待你拍板的开放项：**
- 公共角色库的**素材版权/授权来源**如何确定（决定路径 A 的导入内容）？
- 是否确认**优先做 P0（通用 URL 导入）** 快速见效，再做 P1 公共库？
- 是否已有/计划取得 **TapNow 的正式 API 授权**（决定路径 C 是否排期）？

---

*文档版本 v1.0 · 2026-07-06 · 待评审*
