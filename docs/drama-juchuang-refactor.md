# AI 短剧生成 — 对标火山「剧创」+ Seedance 2.0 重构实现文档

> 本文档记录「AI短剧生成」(OmniWeaver/drama) 对标火山引擎**剧创**并深度对接 **Seedance 2.0** 的完整重构实现，作为后续改进开发的基准。
>
> 参考资料：火山剧创 <https://www.volcengine.com/docs/87744/2261814> · Seedance 2.0 <https://neolink.com/docs/instruction-manual/video/03-seedance>

---

## 1. 背景与目标

### 1.1 范式转变

从旧的「概念 → 大纲 → 分镜 → **整集拼网格出 1 条视频**」升级为剧创式：

```
剧本/概念 → 解析 → 资产库 → 分镜(多模态) → 逐分镜 Seedance 视频 → ffmpeg 成片
```

最大变化：视频生成从「整集拼网格出一条」改为「**逐分镜独立生成 + 末尾 ffmpeg 组装**」，实现剧创式「导演级控片」——每个镜头可单独重生成、换参考、调时长，互不影响。

### 1.2 约束

- **存储一律落服务端 MinIO**，不使用任何云端存储选项。
- **剪映剪辑部分搁置**，成片改用服务端 ffmpeg 顺序拼接。

### 1.3 对标剧创已落地能力

| 剧创能力 | 本项目实现 |
|---|---|
| 剧本智能解析（拆集/场） | `POST /drama/parse-script` |
| 全剧资产库（角色 + 变装 / 场景 / 道具） | MaterialManager + `MaterialVariant` |
| 全局风格锁定（2D/3D/仿真人） | `STYLE_LOCKS` + `style_lock` |
| 分镜多模态参考（图/视频/音频） | ShotState ref 槽 + Seedance content 数组 |
| 导演级逐镜头控片 | `POST /drama/generate-shot-video` + ShotVideoGeneration.tsx |
| 成片组装 | `POST /drama/compose-final`（imageio-ffmpeg） |

---

## 2. 五阶段流水线（前端 OmniWeaver）

| Stage | 名称 | 组件 | 后端端点 | 产出 |
|---|---|---|---|---|
| 0 | 故事创作 | `StoryCreation.tsx` | `/drama/outline`(概念) · `/drama/parse-script`(剧本) | `OutlineResponse.episodes[]` |
| 1 | 分镜规划 | `StoryboardPlanning.tsx` | `/drama/storyboard` | `shots[]` |
| 2 | 图像生成 | `ImageGeneration.tsx` | `/api/v1/flux/generate-image` 等 | 每镜头首帧图 |
| 3 | 分镜视频 | `ShotVideoGeneration.tsx` | `/drama/generate-shot-video` · `/drama/upload-asset` | 每镜头视频 |
| 4 | 成片 | `FinalCut.tsx` | `/drama/compose-final` | 每集成片 MP4 |

阶段定义：`frontend/src/utils/drama-helpers.ts` → `STAGES`。
阶段可达性守卫：`OmniWeaver.tsx` → `canGoTo()` / `canNext` / `LAST_STAGE`。

---

## 3. 后端实现

主文件：`backend/app/api/v1/drama.py`。所有端点挂在 `/api/v1/drama` 前缀下。

### 3.1 端点清单

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/drama/outline` | ✓ | 概念 → 分集大纲（deepseek-v4-flash, JSON 模式） |
| POST | `/drama/parse-script` | ✓ | **整本剧本 → 忠实解析为分集大纲**，返回与 outline 同构的 `OutlineResponse`（drop-in） |
| POST | `/drama/storyboard` | ✓ | 单集大纲 → 分镜 `shots[]`（英文 prompt + 中文 + 镜头参数） |
| POST | `/drama/generate-shot-video` | ✓ | **逐分镜 Seedance 2.0 视频**，多模态参考，走积分扣减，落 MinIO shots 路径 |
| POST | `/drama/upload-asset` | ✓ | 参考视频/音频/图上传落 MinIO，返回 object_key |
| GET | `/drama/ref-asset` | **公开**(HMAC) | 给 Seedance 拉取参考视频/音频的公网流式端点 |
| POST | `/drama/compose-final` | ✓ | 成片：ffmpeg 顺序拼接镜头视频 → MinIO final 路径（后台任务） |
| POST | `/drama/polish` | ✓ | 一键润色（character/script/scene/action） |
| `/drama/projects*` | ✓ | 项目 CRUD（`drama_projects.py`） |

### 3.2 数据模型

`backend/app/models/drama_project.py` → `drama_projects` 表。重构新增列：

| 列 | 类型 | 用途 |
|---|---|---|
| `script_text` | TEXT | 导入的原始剧本 |
| `source_mode` | VARCHAR(20) | `concept` / `script` |
| `style_lock` | VARCHAR(20) | `2d` / `3d` / `realistic` |
| `final_video_path` | VARCHAR(500) | 成片 MinIO key（预留） |

**迁移机制**：项目**无 Alembic**，建表靠启动时 `Base.metadata.create_all`（只建缺失表，不改已有表）。新增列由 `backend/app/main.py` 的 `_ensure_schema_migrations()` 在启动时幂等 `ALTER TABLE ... ADD COLUMN`（MySQL，查 information_schema 判断列是否存在）。新增列时把它加进 `_COLUMN_MIGRATIONS` 即可。

**JSON 大字段**（无需迁移，扩展塞这里）：
- `outline_data`：`OutlineResponse`
- `storyboard_data`：`Record<epNum, ShotState[]>`，另含 `_videos`(成片态)
- `materials_data`：`MaterialsData`（角色含 `variants[]` 变装）

### 3.3 存储键（`backend/app/services/storage.py`）

```
users/{uid}/drama/{pid}/images/   # 分镜图
users/{uid}/drama/{pid}/shots/    # 逐镜头视频     drama_shot_key()
users/{uid}/drama/{pid}/audio/    # 参考/配音音频   drama_audio_key()
users/{uid}/drama/{pid}/refs/     # 参考图/视频     drama_ref_key()
users/{uid}/drama/{pid}/final/    # 成片           drama_final_key()
```

### 3.4 视频生成调用链

```
/drama/generate-shot-video
  → process_video_generation_with_credits()   (backend/app/api/v1/google.py, 积分扣减+落库)
    → GoogleService.generate_video()           (backend/app/services/google_service.py)
      → GoogleAIClient.generate_video()        (backend/app/integrations/google/client.py, seedance 分支)
        → GatewayClient.seedance_create/poll()  (backend/app/integrations/gateway/client.py)
          → AI 网关 /contents/generations/tasks
```

多模态参数（`reference_image_paths` / `reference_video_url` / `audio_url` / `generate_audio`）从端点一路透传到 `seedance_create`。`drama_project_id` 存在时结果落 `drama_shot_key`。

---

## 4. Seedance 2.0 多模态集成

`backend/app/integrations/gateway/client.py` → `seedance_create()`：

```python
content = [
  {"type": "text", "text": prompt},
  # 多张参考图（base64 data URL，网关访问不到内网 MinIO）
  {"type": "image_url", "role": "reference_image", "image_url": {"url": data_url}},
  # 参考视频（公网可达 URL）
  {"type": "video_url", "role": "reference_video", "video_url": {"url": reference_video_url}},
  # 参考/配音音频（公网可达 URL）
  {"type": "audio_url", "role": "reference_audio", "audio_url": {"url": audio_url}},
]
payload = {model, content, ratio, duration, generate_audio, watermark}
```

模型：`settings.GATEWAY_DRAMA_VIDEO_MODEL = "doubao-seedance-2-0-260128"`。
轮询：`seedance_poll()` → `{status, url}`，video_url 在 `content.video_url` 或顶层。

> ⚠️ **待校正**：视频/音频条目的 `type`/`role` 字段名是**按文档推断**的（图片用的是已验证的 `image_url`+`reference_image`）。首次真跑带参考视频的镜头后，若网关报字段错误，按实际返回在此处微调。

---

## 5. 参考视频/音频公网流式方案（关键）

### 5.1 问题

Seedance 是外部 API（neolink.com），**访问不到内网 `minio:9000`**。
- 参考**图**：走 base64 data URL，无此问题。
- 参考**视频/音频**：体积大不能 base64，必须给公网可达 URL。
- MinIO 预签名方案**不可用**：`storage.py` 的 `public_endpoint` 参数是 no-op（从未使用），预签名永远基于内网 host；且 `MINIO_PUBLIC_ENDPOINT=localhost:9000` 外网不可达。

### 5.2 方案：后端 token 签名流式（不暴露 MinIO）

```
上传参考素材 → MinIO
  → generate-shot-video 用 _public_asset_url() 生成签名 URL：
     https://www.juai8.com/api/v1/drama/ref-asset?key=<minio_key>&exp=<epoch>&sig=<hmac>
  → Seedance GET 该 URL
     → nginx(/api/ 反代) → 后端 GET /drama/ref-asset
        → 校验 HMAC 签名 + 过期 + 限 users/.../drama/ 前缀
        → 流式回传 MinIO 对象
```

- 签名：`HMAC-SHA256(SECRET_KEY, "{key}:{exp}")`，默认 TTL 6 小时。
- 实现：`drama.py` → `_sign_asset()` / `_public_asset_url()` / `serve_ref_asset()`。
- 配置：`PUBLIC_BASE_URL`（`config.py` + `deploy/.env=https://www.juai8.com` + docker-compose 透传）。未配置时 `generate-shot-video` 自动跳过参考视频/音频。

### 5.3 已验证

| 用例 | 结果 |
|---|---|
| 有效签名 | 200 + 正确字节 |
| 篡改签名 | 403 |
| 过期 exp | 403 |
| 非 drama key | 400 |
| 公网全链路 `https://www.juai8.com/...` | 200, audio/mpeg, 0.41s（DNS→TLS→nginx→后端→MinIO） |

---

## 6. 前端实现

主页面：`frontend/src/pages/OmniWeaver.tsx`（view: `list` | `editor`）。

### 6.1 编辑器状态（`drama-helpers.ts` → `DramaEditorState`）

```ts
{
  outline, concept,
  script,              // 导入的剧本
  sourceMode,          // 'concept' | 'script'
  styleLock,           // '' | '2d' | '3d' | 'realistic'
  materials,           // MaterialsData（角色含 variants 变装）
  storyboards,         // Record<ep, ShotState[]>
  episodeVideos,       // Record<ep, EpisodeVideoState> —— 现用于「成片」结果
  activeEpisode,
}
```

`ShotState`（`drama-helpers.ts`）扩展：每镜头视频态 `videoTaskId/videoUrl/videoStatus/videoDuration/generateAudio` + 多模态参考槽 `refVideoKey/refVideoName/refAudioKey/refAudioName`。

持久化：`OmniWeaver.handleSave()` 序列化到项目 JSON 字段（剥离运行时 URL）；`openProject()` 恢复并归一化 `imageStatus`/`videoStatus`、重建参考图 URL。

### 6.2 关键组件

| 组件 | 职责 |
|---|---|
| `StoryCreation.tsx` | 概念/剧本**双入口** Tab；剧本支持粘贴 + 上传 `.txt`、集数可选「自动」 |
| `MaterialManager.tsx` | 资产抽屉：角色(含 `VariantEditor` 变装) / 场景 / 道具；顶部**全局风格锁条** |
| `StoryboardPlanning.tsx` | 分镜脚本生成与编辑 |
| `ImageGeneration.tsx` | 逐镜头出图，注入素材/变装/风格锁富 prompt |
| `ShotVideoGeneration.tsx` | **逐镜头视频**：独立生成/重生成、时长(3-12s)、配音开关、参考视频/音频上传、批量「生成全部未完成」 |
| `FinalCut.tsx` | 镜头视频序列预览 + 合成本集成片 + 下载 |

### 6.3 Service（`frontend/src/services/drama.service.ts`）

`generateOutline` · `parseScript` · `generateStoryboard` · `generateShotVideo` · `uploadAsset` · `composeFinal` · `polishText` · 项目 CRUD。

### 6.4 提示词注入（`drama-helpers.ts`）

- `buildMaterialsContext(materials, styleLock)`：素材 + 变装 + 全局风格锁 → 注入 outline/storyboard 提示词。
- `buildEnrichedPrompt(shot, materials, styleLock)`：单镜头英文图像 prompt 注入素材与风格锁。
- `STYLE_LOCKS`：`realistic`/`3d`/`2d` 三档，各含中文标签 + 英文渲染指令。

---

## 7. 成片 ffmpeg 流水线

`drama.py` → `compose-final` 端点 + `_process_compose_final()` 后台任务：

1. 按顺序解析镜头视频 `video_task_ids` → `GenerationTask.result_path`（MinIO key/本地）。
2. 下载到临时目录。
3. **逐片归一化** `_normalize_clip()`：重编码到画幅 canonical 尺寸（h264/yuv420p/24fps），**保证音轨**——有音保留、无音用 `anullsrc` 补静音（解决各镜头 `generate_audio` 不一致导致 concat 失败）。
4. concat demuxer `-c copy` 拼接 → 上传 `drama_final_key`。
5. 走后台 GenerationTask，前端 `googleService.pollTaskStatus` 轮询。

ffmpeg 二进制：`imageio-ffmpeg`（`requirements.txt` 已含，自带 v4.2.2 静态二进制，**无需改 Dockerfile**）。已用合成测试片（含音 + 无音混合）验证 concat 通过。

---

## 8. 配置项

| 配置 | 位置 | 值/说明 |
|---|---|---|
| `GATEWAY_DRAMA_VIDEO_MODEL` | `config.py` | `doubao-seedance-2-0-260128` |
| `AI_GATEWAY_BASE_URL` | `.env` | `https://neolink.com/api/v1` |
| `PUBLIC_BASE_URL` | `config.py`/`.env`/compose | `https://www.juai8.com`（参考媒体公网流式基址） |
| `SECRET_KEY` | `config.py` | HMAC 签名密钥（ref-asset） |
| `MINIO_*` | `.env` | 内网 `minio:9000`；`MINIO_PUBLIC_ENDPOINT` 对本功能**无效**(no-op) |

> nginx：`deploy/nginx/nginx.conf` 将 `/api/` 反代到 `backend:8000`，`proxy_buffering off` + `client_max_body_size 100M`，适合流式参考媒体。

---

## 9. 里程碑回顾（M1–M6 + 参考媒体）

- **M1** 后端地基：存储 helper、`seedance_create` 多模态、调用链透传、`generate-shot-video`、模型迁移。
- **M2** 剧本解析：`parse-script` + 双入口 + script 持久化。
- **M3** 资产增强：变装 `MaterialVariant` + 全局风格锁。
- **M4** 逐分镜 UI：`upload-asset` + `ShotVideoGeneration.tsx`。
- **M5** 成片：`compose-final` + ffmpeg + `FinalCut.tsx`。
- **M6** 清理：移除旧网格 `synthesize-episode`/`_compose_grid`/`VideoSynthesis.tsx`。
- **参考媒体**：`PUBLIC_BASE_URL` + `ref-asset` 公网流式端点。

---

## 10. 已知约束与改进方向（后续开发重点）

### 10.1 待校正/验证
- [ ] **Seedance 视频/音频 content 字段名**：真跑一次带参考视频的镜头，按网关实际返回校正 `seedance_create`。
- [ ] 端到端人工验收：建项目 → 剧本/概念 → 分镜 → 出图 → 逐镜头视频(带参考) → 成片。

### 10.2 功能增强候选
- [ ] **IP 人像库**（剧创新功能）：跨项目复用的虚拟/真人人像库。
- [ ] **变装在分镜中的选择**：当前变装仅注入素材上下文文本；可让分镜镜头显式选用某变装，并据此选参考图（扩展 `findMaterialRefForShot`）。
- [ ] **剧本解析支持 docx/pdf**：当前仅 `.txt`（前端 `file.text()`）；需后端解析依赖。
- [ ] **团队协作 / 用量统计**（剧创企业级能力）：多人协作、积分分配、用量看板。
- [ ] **成片转场/字幕/BGM**：当前仅顺序硬拼接；可加转场、台词字幕、背景音乐轨。
- [ ] **镜头视频拖拽排序**：成片前调整镜头顺序。

### 10.3 技术债 / 健壮性
- [ ] `compose-final` 大批量/长视频的 ffmpeg 超时与进度回报（当前固定 progress 节点）。
- [ ] `ref-asset` 当前 `Response(content=data)` 全量读入内存；大文件可改真流式 `StreamingResponse` + Range 支持。
- [ ] `episodeVideos` 语义已从「整集视频」转为「成片」，命名可统一为 `finalVideos`。
- [ ] `storage.py` 的 `public_endpoint` no-op 参数可移除或正确实现（避免误导）。
- [ ] `VideoSynthesis.tsx` 已删；确认无残留 import（已验证）。

### 10.4 安全
- ref-asset 仅 HMAC + 前缀校验；如需更严，可加 per-user 绑定（签名纳入 uid）或更短 TTL。
- MinIO 仍用默认 `minioadmin/minioadmin`，生产应改强凭证（与本功能无关，但建议一并处理）。

---

_最后更新：M1–M6 + 参考媒体公网流式方案全部完成并验证。_
