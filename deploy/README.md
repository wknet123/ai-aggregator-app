# AI Aggregator Platform - 部署指南

## 目录结构

```
deploy/
├── docker-compose.yml      # Docker Compose 主配置文件
├── .env.example            # 环境变量示例文件
├── deploy.sh               # Linux/Mac 部署脚本
├── deploy.bat              # Windows 部署脚本
├── README.md               # 本说明文档
├── dockerfiles/
│   ├── Dockerfile.backend  # 后端镜像构建文件
│   └── Dockerfile.frontend # 前端镜像构建文件
├── nginx/
│   └── nginx.conf          # Nginx 配置
├── mysql/
│   └── my.cnf              # MySQL 配置
└── init-scripts/
    ├── 01-schema.sql       # 数据库表结构
    └── 02-seed-data.sql    # 初始数据
```

## 快速开始

### 1. 准备环境

确保已安装:
- Docker Engine 20.10+
- Docker Compose 2.0+

### 2. 配置环境变量

```bash
# 进入部署目录
cd deploy

# 复制环境变量示例文件
cp .env.example .env

# 编辑 .env 文件，配置必要的变量
# 至少：DB_*、SECRET_KEY、AI_GATEWAY_API_KEY；按需 ALIPAY_* / DOUYIN_*
#
# 说明：deploy/.env 是全平台唯一的实效环境文件。docker-compose 以此做变量替换，
#       backend / harness-worker 通过 env_file 读取它。backend/frontend 目录下
#       不再单独维护 .env（前端 VITE_API_URL 由 build-arg 从本文件注入）。
```

### 3. 启动服务

**Linux/Mac:**
```bash
chmod +x deploy.sh
./deploy.sh up
```

**Windows:**
```cmd
deploy.bat up
```

### 4. 访问服务

- **前端界面**: http://localhost:80
- **后端 API**: http://localhost:8000
- **API 文档**: http://localhost:8000/docs

### 5. 默认账户

| 账户类型 | 邮箱 | 密码 |
|---------|------|------|
| 管理员 | admin@example.com | 123456 |
| 演示用户 | demo@example.com | 123456 |

> ⚠️ **安全警告**: 请在首次登录后立即修改默认密码！

## 常用命令

| 命令 | 说明 |
|------|------|
| `./deploy.sh up` | 启动所有服务 |
| `./deploy.sh down` | 停止所有服务 |
| `./deploy.sh restart` | 重启所有服务 |
| `./deploy.sh logs` | 查看所有日志 |
| `./deploy.sh logs backend` | 查看后端日志 |
| `./deploy.sh status` | 查看服务状态 |
| `./deploy.sh rebuild` | 重新构建所有镜像 |
| `./deploy.sh rebuild frontend` | 重新构建前端镜像 |
| `./deploy.sh shell backend` | 进入后端容器 |
| `./deploy.sh db` | 连接数据库 |
| `./deploy.sh clean` | 清理所有容器和数据 |

## 环境变量说明

### 数据库配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `DB_ROOT_PASSWORD` | MySQL root 密码 | `Ai@ggregator2024` |
| `DB_NAME` | 数据库名 | `ai_aggregator` |
| `DB_USER` | 数据库用户 | `ai_user` |
| `DB_PASSWORD` | 数据库密码 | `Ai@User2024` |
| `DB_PORT` | 数据库端口 | `3306` |

### AI 服务 API Keys

| 变量 | 说明 |
|------|------|
| `GOOGLE_API_KEY` | Google AI API Key (Imagen, Veo) |
| `OPENAI_API_KEY` | OpenAI API Key (DALL-E, GPT) |
| `FLUX_API_KEY` | Flux AI API Key |
| `WORLDLABS_API_KEY` | World Labs API Key |

### 应用配置

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `SECRET_KEY` | JWT 加密密钥 | 请修改 |
| `BACKEND_PORT` | 后端端口 | `8000` |
| `FRONTEND_PORT` | 前端端口 | `80` |
| `DEFAULT_CREDITS` | 新用户默认积分 | `200` |

## 生产环境部署建议

### 1. 安全配置

- 修改所有默认密码
- 使用强随机 `SECRET_KEY`
- 配置 HTTPS (使用 Nginx 反向代理 + Let's Encrypt)
- 限制数据库端口外部访问

### 2. 性能优化

- 增加 `innodb_buffer_pool_size` (建议物理内存的 70-80%)
- 配置 Redis 持久化
- 使用 CDN 加速前端静态资源

### 3. 监控告警

- 配置日志收集 (ELK Stack 或 Loki)
- 设置健康检查告警
- 监控容器资源使用

### 4. 备份策略

```bash
# 备份数据库
docker compose exec db mysqldump -u root -pAi@ggregator2024 ai_aggregator > backup_$(date +%Y%m%d).sql

# 恢复数据库
docker compose exec -T db mysql -u root -pAi@ggregator2024 ai_aggregator < backup_20240101.sql
```

## 故障排查

### 容器无法启动

```bash
# 查看详细日志
docker compose logs -f [service_name]

# 检查容器状态
docker compose ps
```

### 数据库连接失败

```bash
# 确认数据库健康
docker compose exec db mysqladmin ping -h localhost

# 检查连接
docker compose exec db mysql -u ai_user -pAi@User2024 -e "SELECT 1"
```

### 前端无法访问后端

1. 确认 `VITE_API_URL` 配置正确
2. 检查 Nginx 代理配置
3. 确认后端容器正常运行

## 更新部署

```bash
# 拉取最新代码
git pull

# 重新构建并部署
./deploy.sh rebuild

# 或只重建特定服务
./deploy.sh rebuild backend
```

## 技术支持

如有问题，请检查:
1. Docker 日志: `./deploy.sh logs`
2. 容器状态: `./deploy.sh status`
3. 环境变量配置: `.env` 文件
