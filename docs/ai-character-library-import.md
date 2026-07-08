# AI 角色库（AI角色）功能 — 工作总结与导入指南

> 为 OmniWeaver（剧创）项目「要素配置·角色」新增的全局只读 AI 角色资源库。
> 用户浏览选择后一键实例化为项目内可编辑的角色要素。
> 落地日期：2026-07-07。

---

## 1. 功能概述

- 入口：OmniWeaver Pro →「要素配置」页签 →「角色」子页签 →「AI角色库」按钮（仅角色类型可见）。
- 浏览页（排版对标 `AI_role_stock/main.png`）：
  - 左侧多级分类导航树（逐级目录 = 一级导航）
  - 顶部面包屑 + 角色名搜索
  - 顶部属性筛选 chips（性别 / 年龄段 / 物种 / 体格 / 身高 / 肤色 / 发长 / 发色 / 气质，多选取交集）
  - 角色卡片网格（封面图 + 名称 +「性别·年龄段·体格·气质」摘要）
- 详情弹窗（排版对标 `AI_role_stock/detail.png`）：
  - 左侧 `1/2/3/4` 号图「从左上顺时针」四宫格（角色立绘 / 肖像特写 / 表情九宫格 / 三视图）
  - 右侧角色属性网格 + 辨识特征 + 着装描述
  - 上一个 / 下一个切换
  - 底部「应用到画布」
- **权限**：AI 角色定义全局只读，普通用户不可增删改；「应用到画布」会**复制**图片与属性到当前项目，
  生成一个独立可编辑的 `ProjectAsset(character)`，用户可在分镜配置中自由改名 / 改属性 /
  增删图片，且不影响全局定义。实例自动获得现有「被分镜引用时禁止删除」保护。

---

## 2. 资源目录约定

资源根目录（示例）：`/home/juhe0092/AI_role_stock`

```
AI_role_stock/
  main.png, detail.png          ← 顶层参考图（仅供开发排版参考，导入时跳过）
  古代历史/                      ← 一级分类
    中国-先秦/                   ← 二级分类
      诸侯国君/                  ← 叶子文件夹 = 一个角色
        1.png 2.png 3.png 4.png  ← 从左上顺时针：立绘/肖像特写/表情九宫格/三视图
        角色属性.txt             ← 角色属性 + 辨识特征 + 着装描述
      贵族卿大夫之女/
      ...
```

规则：
- 逐级目录 → 一级分类导航（物化路径 `path`，如 `古代历史/中国-先秦`）。
- 含 `角色属性.txt`（兼容 `角色描述.txt`）的文件夹 = 一个角色，文件夹名 = 角色名。
- 图片按 `1.png`~`N.png` 编号，编号即 slot（1/2/3/4 对应详情页四宫格位置）。
- **不完整目录**（既无 `角色属性.txt` 又无子目录，或缺 `1-4.png`）会被跳过并告警，不建分类/角色。

### `角色属性.txt` 结构（固定 13 维属性 + 两段自由文本）

```
角色属性

大类
    古代
文化区域
    东亚
时代
    先秦
性别
    男
年龄段
    中年
物种
    人类
体格
    壮硕
身高
    高挑
肤色
    中等
发长
    长发
发色
    黑
气质
    威严
场景
    诸侯争霸与百家争鸣

辨识特征

重瞳，颌下留有修整齐整的虬髯

着装描述

玄色纁边曲裾深衣，腰系金钩革带，佩双龙纹玉璧，头戴垂旒高冠，足蹬方头履。
```

解析器：`backend/app/utils/ai_character_parser.py`（`parse_character_attributes`）。

---

## 3. 存储布局

- **MinIO**（bucket `ai-aggregator`，公共只读前缀）：
  ```
  public/ai_characters/{分类路径}/{character_key}/{slot}.png
  ```
  key 构造器：`StorageService.ai_character_key()`。
- **数据库**（三张新表，随 `Base.metadata.create_all` 自动创建）：
  - `ai_character_categories`：`parent_id`(自引用) / `name` / `path`(唯一物化路径) / `level` / `sort_order`
  - `ai_characters`：`character_key`(UUID) / `category_id` / `path` / `name` /
    `attributes_json` / `attributes_raw` / `feature_desc` / `costume_desc` / `cover_path`
  - `ai_character_images`：`ai_character_id` / `image_path`(MinIO key) / `slot` / `sort_order`
- `project_assets` 新增列 `source_ai_character_key`（溯源；由 `main.py` 的 `_COLUMN_MIGRATIONS` 幂等添加）。

---

## 4. 导入方式（资源持续追加时使用）⭐

导入脚本：`backend/scripts/import_ai_characters.py`（**幂等**，以 `分类路径 + 角色名` 为自然键去重，
已存在的角色默认跳过，可反复运行以增量追加新资源）。

后端以 baked 镜像方式运行（代码 COPY 进镜像，仅 `./storage` 为 bind mount），
资源目录默认不在容器内，需先拷入容器再运行：

```bash
# 1) 把资源目录拷进 backend 容器（首次或有新增时）
docker cp /home/juhe0092/AI_role_stock ai-aggregator-backend:/data_ai_role_stock

# 2) 干跑预览（不写库/不上传，检查将导入哪些角色）
docker compose -f deploy/docker-compose.yml exec backend \
  python -m scripts.import_ai_characters --root /data_ai_role_stock --dry-run

# 3) 正式导入（新增资源会追加，已存在的跳过）
docker compose -f deploy/docker-compose.yml exec backend \
  python -m scripts.import_ai_characters --root /data_ai_role_stock
```

参数：
- `--root PATH`：资源根目录（容器内路径，默认 `/data/AI_role_stock`）
- `--force`：连同已存在角色一并重导（先删旧图 + 旧记录再重建）
- `--dry-run`：只扫描打印，不写库/不上传

> 更省事的替代：在 `deploy/docker-compose.yml` 的 backend 增加只读挂载
> `- /home/juhe0092/AI_role_stock:/data/AI_role_stock:ro`，则可省去 `docker cp`，
> 直接 `python -m scripts.import_ai_characters`。

首次导入结果：**2 个分类节点（古代历史 / 中国-先秦）、39 个角色、156 张图片**。

---

## 5. 后端 API（`/api/v1/ai-characters`，只读）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/categories` | 分类树（嵌套，含每级角色计数） |
| GET | `/filters?category_path=` | 各属性维度可选值（供筛选栏） |
| GET | `/?category_path=&q=&<属性>=值1,值2&limit=&offset=` | 角色列表（分类前缀 + 名称 + 属性维度筛选） |
| GET | `/{character_key}` | 角色详情（四宫格图 + 全属性 + 两段描述） |
| GET | `/{character_key}/images/{image_id}/file` | 流式图片（character_key 作能力令牌，无鉴权，`<img src>` 直用） |

实例化端点（复用 project_assets）：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/project-assets/from-ai-character` | body: `project_id`, `ai_character_key`, 可选 `name` / `slots`。复制图片到用户项目，创建可编辑角色要素 |

---

## 6. 涉及文件

**新增**
- `backend/app/models/ai_character.py` — 三张表模型
- `backend/app/utils/ai_character_parser.py` — 角色属性.txt 解析器
- `backend/app/api/v1/ai_characters.py` — 只读浏览 API
- `backend/scripts/import_ai_characters.py` — 导入脚本
- `frontend/src/services/ai-character.service.ts` — 前端服务
- `frontend/src/components/drama/AICharacterLibraryModal.tsx` — 浏览 + 详情弹窗

**修改**
- `backend/app/models/__init__.py` — 注册模型
- `backend/app/models/project_asset.py` — 新增 `source_ai_character_key` 列
- `backend/app/services/storage.py` — 新增 `ai_character_key()` 构造器
- `backend/app/main.py` — 注册路由 + `_COLUMN_MIGRATIONS` 加列
- `backend/app/api/v1/project_assets.py` — 新增 `from-ai-character` 端点 + 序列化溯源字段
- `frontend/src/components/drama/AssetConfigPanel.tsx` — 角色页签「AI角色库」入口按钮 + 弹窗接入

---

## 7. 部署

后端 / 前端均以 baked 镜像运行，代码变更后需重建镜像：

```bash
cd deploy
docker compose up -d --build backend
docker compose up -d --build frontend
```

- 新表在后端启动时经 `Base.metadata.create_all` 自动创建。
- `project_assets.source_ai_character_key` 列由 `_ensure_schema_migrations` 幂等补齐。
- 已导入的角色数据与 MinIO 图片位于持久化卷（`mysql_data` / `minio_data`），重建镜像不丢失。
