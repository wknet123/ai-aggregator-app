# AI 创作平台 - 前端重构上下文

> 最后更新: 2026-02-04
> 目标: 将 UI 重构为 Pollo.ai 风格，保留所有现有业务逻辑

---

## 一、已完成工作

### 1. 模型状态统一 ✅
- **Google Imagen 4.0**: 设为默认图像模型，`enabled: true`
- **Google Veo**: 默认视频模型，`enabled: true`
- **GPT-Image 1.5, Flux Kontext Pro/Max**: `enabled: false`, `comingSoon: true`
- **Sora 2, Marble 3D**: `enabled: false`, `comingSoon: true`
- 文件: `src/config/models.config.ts`, `src/types/model.types.ts`

### 2. 文案统一 ✅
- 所有 "即将" 统一改为 "即将上线"
- 涉及文件: Portal.tsx, Pricing.tsx, AIWorkbench.tsx, Sidebar.tsx, ModelSelector.tsx

### 3. 移动端适配 ✅
| 页面 | 优化内容 |
|------|---------|
| Portal.tsx | 汉堡菜单、响应式 hero 文字、自适应卡片 |
| Pricing.tsx | 可滚动标签栏、响应式卡片间距 |
| AIWorkbench.tsx | 轮播单卡模式(移动端)、响应式输入框 |
| Gallery.tsx | 动态网格布局、响应式行高 |
| ModelSelector.tsx | 垂直堆叠下拉菜单(移动端) |
| globals.css | 响应式组件类 (tab-pill, input-large 等) |

### 4. 轮播组件优化 ✅
- **移动端**: 单卡滑动模式，translate-x 动画
- **桌面端**: 多卡展示，flex 布局
- 分离的导航箭头和指示点
- 文件: `src/pages/AIWorkbench.tsx` (lines 720-850)

### 5. 浏览器标签页 ✅
- 统一标题: "AI创作平台 - 智能创意生成"
- 自定义 Logo: `/public/logo.svg` (粉紫渐变 + 星形图标)
- 动态页面标题: `src/hooks/useDocumentTitle.ts`
- 已集成页面: Portal, Gallery, AIWorkbench, Credits, Settings, Pricing, Login, Register, OmniWeaver

### 6. Portal 页面布局 ✅
- 标题下移: `pt-16 md:pt-24 lg:pt-32`
- 标题字号缩小: `text-2xl sm:text-3xl md:text-4xl lg:text-5xl`
- 标题与输入框间距加大: `mb-12 md:mb-16 lg:mb-20`

### 7. Gallery 画廊重构 ✅ (Pollo.ai 风格)
- 动态网格: 2列(手机) → 3列(平板) → 4列(桌面) → 5列(大屏)
- 动态卡片尺寸: 大(2x2)、高(1x2)、宽(2x1)、小(1x1)
- 紧凑间距: 1-1.5px gaps
- 全出血图片 + 底部渐变遮罩
- 视频悬停播放
- 收藏/下载/删除交互

---

## 二、待办事项

### 高优先级
- [ ] **Sidebar 分组导航**: 按 "导航/AI创作/工具/账户" 分组
- [ ] **"+ 新建" 按钮**: 侧边栏顶部渐变按钮
- [ ] **CompactConfigBar 样式**: 选项间分隔线、hover 效果

### 中优先级
- [ ] **Header Logo 点击**: 跳转首页
- [ ] **深色主题统一**: 检查所有页面色值一致性
- [ ] **加载状态优化**: shimmer 效果统一

### 低优先级
- [ ] **动画过渡**: 页面切换动画
- [ ] **骨架屏**: Gallery 加载骨架
- [ ] **PWA 支持**: manifest.json, service worker

---

## 三、已知问题 (坑)

### 1. 轮播布局问题
- **问题**: 移动端使用 flex 布局时，非当前卡片仍占用空间
- **解决**: 移动端改用绝对定位 + translate-x 动画
- **位置**: `AIWorkbench.tsx` lines 740-810

### 2. Grid Span 溢出
- **问题**: `col-span-2` 在 2 列网格中可能溢出
- **解决**: 使用 `Math.min(span.colSpan, gridCols)` 或 CSS 类条件
- **位置**: `Gallery.tsx` getSpanPattern 函数

### 3. 视频自动播放限制
- **问题**: iOS Safari 限制自动播放
- **解决**: 添加 `playsInline` 和 `muted` 属性
- **位置**: 所有 video 标签

### 4. Tailwind 动态类名
- **问题**: `col-span-${value}` 动态类名不会被 Tailwind 编译
- **解决**: 使用完整类名或 style 属性
- **示例**: `className={colSpan === 2 ? 'col-span-2' : 'col-span-1'}`

### 5. 图片加载失败
- **问题**: 外部图片 URL 可能失效
- **解决**: 添加 onError 回退 SVG placeholder
- **位置**: Gallery.tsx, AIWorkbench.tsx

### 6. useDocumentTitle 依赖
- **问题**: 组件卸载时 title 恢复可能闪烁
- **解决**: useEffect cleanup 恢复 previousTitle
- **位置**: `src/hooks/useDocumentTitle.ts`

---

## 四、关键文件结构

```
frontend/
├── public/
│   └── logo.svg                    # 站点 Logo (新增)
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx          # 顶栏
│   │   │   └── Sidebar.tsx         # 侧边栏 (待重构)
│   │   └── model/
│   │       ├── CompactConfigBar.tsx # 配置栏 (待优化)
│   │       ├── ModelSelector.tsx   # 模型选择器 (已优化)
│   │       └── ImageUploader.tsx   # 图片上传
│   ├── config/
│   │   └── models.config.ts        # 模型配置 (已更新)
│   ├── hooks/
│   │   └── useDocumentTitle.ts     # 页面标题 Hook (新增)
│   ├── pages/
│   │   ├── Portal.tsx              # 首页 (已优化)
│   │   ├── Pricing.tsx             # 定价页 (已优化)
│   │   ├── AIWorkbench.tsx         # 创作工作台 (已优化)
│   │   ├── Gallery.tsx             # 作品画廊 (已重构)
│   │   ├── Credits.tsx             # 积分页 (已优化)
│   │   └── Settings.tsx            # 设置页 (已优化)
│   ├── styles/
│   │   └── globals.css             # 全局样式 (已更新)
│   └── types/
│       └── model.types.ts          # 模型类型 (已更新)
└── index.html                      # HTML 入口 (已更新)
```

---

## 五、核心函数清单 (不可修改逻辑)

| 文件 | 函数名 | 说明 |
|------|--------|------|
| Header.tsx | `handleLogout` | 退出登录 |
| Header.tsx | `fetchBalance` (useEffect) | 获取余额 |
| Sidebar.tsx | `handleLinkClick` | 导航点击 |
| AIWorkbench.tsx | `handleGenerate` | 生成操作 |
| AIWorkbench.tsx | `getCategoryFromRoute` | 路由解析 |
| AIWorkbench.tsx | `handleFileSelect` | 文件上传 |
| Gallery.tsx | `loadGallery` | 加载数据 |
| Gallery.tsx | `handleDelete` | 删除作品 |
| Gallery.tsx | `handleDownload` | 下载作品 |
| Gallery.tsx | `handleToggleFavorite` | 收藏切换 |
| CompactConfigBar.tsx | 全部函数 | 配置逻辑 |
| models.config.ts | `calculateCost` | 积分计算 |
| models.config.ts | `getModelsByCategory` | 获取模型列表 |

---

## 六、开发命令

```bash
# 启动开发服务器
cd /home/juhe0092/ai-aggregator-code/frontend && npm run dev

# 构建生产版本
npm run build

# 类型检查
npm run type-check
```

---

## 七、设计参考

- **主色调**: 粉色 `#e91e8c` → 紫色 `#a855f7` → 靛蓝 `#6366f1`
- **背景色**: `#0d0d0f` (最深), `#16161a` (卡片), `#1a1a1f` (输入框)
- **边框色**: `border-gray-800/50`, `border-gray-700/50`
- **参考站点**: Pollo.ai (~/pollo-ai-works-tile.png)

---

## 八、下次继续时

1. 运行 `npm run dev` 检查当前状态
2. 优先完成 Sidebar 分组导航
3. 注意测试移动端响应式布局
4. 检查控制台是否有 TypeScript 错误
