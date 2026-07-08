# AI 角色库（AI角色）功能实现方案

## 1. 目标

为 OmniWeaver（剧创系统）**每个要素配置**增加"AI角色"浏览选择功能：
- 数据源：`/home/juhe0092/AI_role_stock` 的多级目录树，逐级作为导航
- 浏览页排版参考 `main.png`（左侧多级导航树 + 顶部属性筛选 + 卡片网格）
- 详情**弹窗**排版参考 `detail.png`（左上顺时针 4 图 + 右侧属性/辨识特征/着装描述 + "应用到画布"）
- 资源存入本地 **MinIO**，导入方式记录到工作总结
- AI角色定义**全局只读**，用户不可删改；选入项目后成为**可改名/改属性**的分镜角色

## 2. 数据模型（新增，读写分离）

新建 `backend/app/models/ai_character.py`：

- `AICharacterCategory`（分类树）
  - `id`, `parent_id`(自引用, nullable), `name`, `path`(物化路径, 如 `古代历史/中国-先秦`), `level`, `sort_order`
- `AICharacter`（角色定义, 全局无 user_id）
  - `character_key`(UUID), `category_id`(FK), `name`(=文件夹名), `path`(所属分类路径)
  - `attributes_json`(Text, 解析后的属性字典), `attributes_raw`(Text, 原始 txt)
  - `feature_desc`(辨识特征), `costume_desc`(着装描述), `cover_path`(MinIO key), `sort_order`
- `AICharacterImage`
  - `ai_character_id`(FK), `image_path`(MinIO key), `slot`(1-4, 对应 1/2/3/4.png), `sort_order`

在 `backend/app/models/__init__.py` 注册三张表（`create_all` 自动建表）。

`ProjectAsset` 增加可选溯源列 `source_ai_character_key`（VARCHAR(36) NULL），通过 `main.py` 的 `_COLUMN_MIGRATIONS` 幂等添加；仅作溯源，不影响可编辑性。

## 3. MinIO 存储布局

`storage.py` 新增 key 构造器：
```
public/ai_characters/{category_path}/{character_key}/{slot}.png
```
放在 `public/` 前缀（公共只读资源），与现有 `public/` 语义一致。

## 4. 导入脚本（幂等，可反复运行以追加新资源）

`backend/scripts/import_ai_characters.py`（沿用 `seed_public_resources.py` + `AsyncSessionLocal` + `get_storage_service().upload_bytes` 模式）：
1. 递归扫描 `AI_role_stock`，跳过 `.DS_Store` 与顶层 `main.png/detail.png`
2. 每级目录 upsert `AICharacterCategory`（按 path 去重）
3. 每个含 `角色属性.txt` 的叶子文件夹 = 一个角色：
   - 解析 txt → 属性字典 + 辨识特征 + 着装描述
   - 上传 `1-4.png` 到 MinIO，写 `AICharacter` + `AICharacterImage`
   - 以 `path + name` 为自然键去重；已存在则跳过（支持增量追加）
4. 打印统计。运行：`docker compose exec backend python -m scripts.import_ai_characters`
   - 支持 `--root` 参数指定资源目录，默认 `/home/juhe0092/AI_role_stock`

## 5. 后端浏览 API

新建 `backend/app/api/v1/ai_characters.py`，注册前缀 `/api/v1/ai-characters`（只读，无删改端点）：
- `GET /categories` — 返回完整分类树（含每个分类下角色计数）
- `GET /?category_path=&q=&filters=` — 角色列表（支持按 path 前缀 + 名称 + 属性维度筛选，对应 main.png 顶部筛选）
- `GET /{character_key}` — 角色详情（4 图 + 全部属性 + 两段描述）
- `GET /{character_key}/images/{image_id}/file` — 流式返回图片（无鉴权, character_key 作为能力令牌, 复用 project_assets 图片端点模式, 支持 `<img src>`）
- `POST /import`（可选, `check_admin_permission` 保护）— 触发服务器端重新导入

Schema: `backend/app/schemas/ai_character.py`（`from_attributes=True`, 包 `ResponseBase`）。

## 6. "应用到画布"：实例化为项目要素

`project_assets.py` 新增端点：
- `POST /from-ai-character` — body: `{project_id, ai_character_key, selected_slots?}`
  - 服务端读取 AI角色的 MinIO 图片字节，复制到
    `users/{uid}/drama/{project_id}/assets/{new_asset_id}/` 下
  - 创建 `ProjectAsset(asset_type='character')`，`name`=角色名，`description`=辨识特征+着装描述+属性摘要，`source_ai_character_key`=溯源
  - 返回新建的可编辑要素

这样：定义只读、实例可改名改属性、并自动获得现有"被分镜引用时禁删"保护。

## 7. 前端

`frontend/src/services/ai-character.service.ts`（新增）：`listCategories / listCharacters / getCharacter / imageUrl / applyToProject`。

`frontend/src/components/drama/AICharacterLibraryModal.tsx`（新增，全屏弹窗）：
- 布局对标 `main.png`：左侧多级导航树 + 顶部属性筛选 chips + 卡片网格（名称 + 性别·年龄·体格·气质 摘要行）
- 卡片点击 → 详情弹窗（对标 `detail.png`）：
  - 左上顺时针 4 图（立绘 / 肖像特写 / 表情九宫格 / 三视图），右侧属性网格 + 辨识特征 + 着装描述
  - 底部"应用到画布"→ 调 `applyToProject` → 在当前项目要素中新建角色 → 关闭并刷新
  - 支持上一个/下一个切换（对标 detail.png 顶部箭头）

接入点 `AssetConfigPanel.tsx`：
- 顶部"新增"旁 + 操作条（`:364`）增加"AI角色库"按钮，仅在 `type==='character'` 时展示
- 打开 `AICharacterLibraryModal`，应用后 `load()` 刷新要素列表

## 8. 交付物 / 工作总结

`docs/ai-character-library-import.md` 记录：资源目录结构约定、导入命令、MinIO 布局、增量追加方式、表结构、如何新增分类/角色。

## 9. 涉及文件清单

新增：
- `backend/app/models/ai_character.py`
- `backend/app/schemas/ai_character.py`
- `backend/app/api/v1/ai_characters.py`
- `backend/scripts/import_ai_characters.py`
- `frontend/src/services/ai-character.service.ts`
- `frontend/src/components/drama/AICharacterLibraryModal.tsx`
- `docs/ai-character-library-import.md`（工作总结）

修改：
- `backend/app/models/__init__.py`（注册模型）
- `backend/app/models/project_asset.py`（+ source_ai_character_key）
- `backend/app/services/storage.py`（+ key 构造器）
- `backend/app/main.py`（注册路由 + _COLUMN_MIGRATIONS 加列）
- `backend/app/api/v1/project_assets.py`（+ from-ai-character 端点）
- `frontend/src/components/drama/AssetConfigPanel.tsx`（+ 入口按钮 + 弹窗接入）
</content>
