-- ============================================
-- AI Aggregator Platform - Complete Database Schema
-- MySQL 8.0+ Compatible
-- Version: 2.0.0
-- Last Updated: 2026-01-13
-- ============================================

-- 数据库/用户初始化由 MySQL 官方镜像根据环境变量完成：
-- MYSQL_DATABASE / MYSQL_USER / MYSQL_PASSWORD。
-- 本脚本仅负责建表与种子数据，避免与 .env 脱节。

-- ============================================
-- 1. Tenants Table (Multi-tenant architecture)
-- ============================================
CREATE TABLE IF NOT EXISTS tenants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    max_users INT DEFAULT 10,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
    INDEX idx_tenants_slug (slug),
    INDEX idx_tenants_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 2. Users Table
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE NOT NULL,
    tenant_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    INDEX idx_users_email (email),
    INDEX idx_users_username (username),
    INDEX idx_users_tenant_id (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 3. Credits Table
-- ============================================
CREATE TABLE IF NOT EXISTS credits (
    id INT AUTO_INCREMENT PRIMARY KEY,
    balance INT DEFAULT 0 NOT NULL,
    total_recharged INT DEFAULT 0 NOT NULL,
    total_consumed INT DEFAULT 0 NOT NULL,
    tenant_id INT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    INDEX idx_credits_tenant_id (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 4. Transactions Table
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('RECHARGE', 'CONSUMPTION', 'REFUND', 'ADJUSTMENT') NOT NULL,
    amount INT NOT NULL,
    status ENUM('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED') DEFAULT 'PENDING' NOT NULL,
    description VARCHAR(255),
    reference_id VARCHAR(100),
    tenant_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    INDEX idx_transactions_tenant_id (tenant_id),
    INDEX idx_transactions_type (type),
    INDEX idx_transactions_status (status),
    INDEX idx_transactions_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 5. API Keys Table
-- ============================================
CREATE TABLE IF NOT EXISTS api_keys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    api_key VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    expires_at DATETIME,
    last_used_at DATETIME,
    user_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_api_keys_api_key (api_key),
    INDEX idx_api_keys_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 6. Model Usages Table
-- ============================================
CREATE TABLE IF NOT EXISTS model_usages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    model_provider VARCHAR(50) NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    cost DECIMAL(10, 4) NOT NULL,
    input_tokens INT DEFAULT 0,
    output_tokens INT DEFAULT 0,
    extra_data JSON,
    tenant_id INT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    INDEX idx_model_usages_tenant_id (tenant_id),
    INDEX idx_model_usages_provider (model_provider),
    INDEX idx_model_usages_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 7. Workflow Instances Table (OmniWeaver)
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_instances (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    user_id INT NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status ENUM('DRAFT', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED') DEFAULT 'DRAFT' NOT NULL,
    current_step_index INT DEFAULT 0 NOT NULL,
    total_cost VARCHAR(20) DEFAULT '0' NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
    completed_at DATETIME,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_workflow_instances_tenant_id (tenant_id),
    INDEX idx_workflow_instances_user_id (user_id),
    INDEX idx_workflow_instances_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 8. Workflow Steps Table
-- ============================================
-- ai_aggregator.workflow_steps definition

CREATE TABLE `workflow_steps` (
  `id` int NOT NULL AUTO_INCREMENT,
  `workflow_id` int NOT NULL,
  `step_index` int NOT NULL,
  `step_type` enum('TEXT_TO_IMAGE','IMAGE_TO_VIDEO','VIDEO_TO_3D') NOT NULL,
  `status` enum('PENDING','PROCESSING','AWAITING_CONFIRMATION','COMPLETED','FAILED') NOT NULL,
  `model_id` varchar(100) NOT NULL,
  `input_data` json DEFAULT NULL,
  `output_data` json DEFAULT NULL,
  `is_optional` bool NOT NULL,
  `cost` varchar(20) NOT NULL,
  `error_message` text DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_workflow_steps_workflow_id` (`workflow_id`),
  KEY `ix_workflow_steps_id` (`id`),
  FOREIGN KEY (`workflow_id`) REFERENCES `workflow_instances` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
);

-- ============================================
-- 9. Generation Tasks Table (AI Generation Jobs)
-- ============================================
CREATE TABLE IF NOT EXISTS generation_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id VARCHAR(64) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    tenant_id INT NOT NULL,
    model_id VARCHAR(50) NOT NULL,
    task_type VARCHAR(20) NOT NULL COMMENT 'image, video',
    prompt TEXT NOT NULL,
    parameters TEXT COMMENT 'JSON string of generation parameters',
    status VARCHAR(20) DEFAULT 'pending' NOT NULL COMMENT 'pending, processing, completed, failed',
    progress INT DEFAULT 0,
    result_path VARCHAR(500),
    result_url VARCHAR(500),
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME COMMENT 'Soft delete timestamp',
    is_favorite INT(32) DEFAULT 0 NULL,
    INDEX idx_generation_tasks_task_id (task_id),
    INDEX idx_generation_tasks_user_id (user_id),
    INDEX idx_generation_tasks_tenant_id (tenant_id),
    INDEX idx_generation_tasks_status (status),
    INDEX idx_generation_tasks_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- 10. Credit Packages Table (积分套餐)
-- ============================================
CREATE TABLE IF NOT EXISTS credit_packages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    name VARCHAR(100) NOT NULL COMMENT '套餐名称',
    description VARCHAR(500) DEFAULT NULL COMMENT '套餐描述',
    credits INT NOT NULL COMMENT '包含积分数量',
    price DECIMAL(10, 2) NOT NULL COMMENT '价格（元）',
    original_price DECIMAL(10, 2) DEFAULT NULL COMMENT '原价（用于显示折扣）',
    is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
    sort_order INT DEFAULT 0 COMMENT '排序顺序',
    badge VARCHAR(50) DEFAULT NULL COMMENT '徽章标签（如：热门、推荐）',
    INDEX idx_credit_packages_is_active (is_active),
    INDEX idx_credit_packages_sort_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分套餐表';

-- ============================================
-- 11. Payment Orders Table (支付订单)
-- ============================================
CREATE TABLE IF NOT EXISTS payment_orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 订单基本信息
    order_no VARCHAR(64) NOT NULL COMMENT '订单号',
    tenant_id INT NOT NULL COMMENT '租户ID',
    user_id INT NOT NULL COMMENT '用户ID',
    
    -- 套餐信息
    package_id INT NOT NULL COMMENT '套餐ID',
    package_name VARCHAR(100) NOT NULL COMMENT '套餐名称（冗余字段）',
    credits INT NOT NULL COMMENT '购买积分数量',
    
    -- 支付信息
    amount DECIMAL(10, 2) NOT NULL COMMENT '支付金额（元）',
    payment_method ENUM('ALIPAY', 'WECHAT', 'MANUAL') NOT NULL COMMENT '支付方式',
    status ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED', 'CANCELLED') NOT NULL DEFAULT 'PENDING' COMMENT '支付状态',
    
    -- 第三方支付信息
    trade_no VARCHAR(128) DEFAULT NULL COMMENT '第三方交易号',
    qr_code TEXT DEFAULT NULL COMMENT '支付二维码内容',
    
    -- 回调信息
    notify_time DATETIME DEFAULT NULL COMMENT '通知时间',
    notify_data TEXT DEFAULT NULL COMMENT '回调通知数据（JSON）',
    
    -- 时间戳
    paid_at DATETIME DEFAULT NULL COMMENT '支付完成时间',
    expired_at DATETIME DEFAULT NULL COMMENT '过期时间',
    
    -- 备注
    remark VARCHAR(500) DEFAULT NULL COMMENT '备注',
    error_message VARCHAR(500) DEFAULT NULL COMMENT '错误信息',
    
    UNIQUE KEY uk_order_no (order_no),
    UNIQUE KEY uk_trade_no (trade_no),
    INDEX idx_payment_orders_tenant_id (tenant_id),
    INDEX idx_payment_orders_user_id (user_id),
    INDEX idx_payment_orders_status (status),
    INDEX idx_payment_orders_created_at (created_at),
    
    CONSTRAINT fk_payment_orders_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_payment_orders_package FOREIGN KEY (package_id) REFERENCES credit_packages(id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支付订单表';


-- ============================================
-- INITIAL DATA SEEDING
-- ============================================

-- ============================================
-- Create Default Tenant
-- ============================================
INSERT INTO tenants (name, slug, is_active, max_users) VALUES 
('Default Organization', 'default', TRUE, 100)
ON DUPLICATE KEY UPDATE name = name;

-- ============================================
-- Create Admin User
-- Password: 123456 (bcrypt hashed)
-- IMPORTANT: Change this password after first login!
-- ============================================
INSERT INTO users (email, username, hashed_password, full_name, is_active, is_admin, tenant_id) VALUES 
(
    'admin@example.com',
    'admin',
    '$2b$12$7Xzm8wIWidwNQ90n6DVnROQbJ0FsbNbfHdFNOuBfs9e21tzNa.R8S',
    'System Administrator',
    TRUE,
    TRUE,
    (SELECT id FROM tenants WHERE slug = 'default')
)
ON DUPLICATE KEY UPDATE email = email;

-- ============================================
-- Create Demo User
-- Password: 123456 (bcrypt hashed)
-- ============================================
INSERT INTO users (email, username, hashed_password, full_name, is_active, is_admin, tenant_id) VALUES 
(
    'demo@example.com',
    'demo',
    '$2b$12$7Xzm8wIWidwNQ90n6DVnROQbJ0FsbNbfHdFNOuBfs9e21tzNa.R8S',
    'Demo User',
    TRUE,
    FALSE,
    (SELECT id FROM tenants WHERE slug = 'default')
)
ON DUPLICATE KEY UPDATE email = email;

-- ============================================
-- Initialize Credits for Default Tenant
-- Starting with 1000 credits
-- ============================================
INSERT INTO credits (balance, total_recharged, total_consumed, tenant_id) VALUES 
(
    1000,
    1000,
    0,
    (SELECT id FROM tenants WHERE slug = 'default')
)
ON DUPLICATE KEY UPDATE balance = balance;

-- ============================================
-- Record Initial Credit Transaction
-- ============================================
INSERT INTO transactions (type, amount, status, description, tenant_id) VALUES 
(
    'RECHARGE',
    1000,
    'COMPLETED',
    'Initial credit allocation for new account',
    (SELECT id FROM tenants WHERE slug = 'default')
);

-- ============================================
-- Initialize Default Credit Packages
-- ============================================
INSERT IGNORE INTO credit_packages (name, description, credits, price, original_price, sort_order, badge, is_active) VALUES
('体验包', '新手入门首选', 100, 9.90, 19.90, 1, '推荐', 1),
('标准包', '日常创作足够', 500, 49.00, 99.00, 2, '热门', 1),
('专业包', '高频使用优选', 1000, 89.00, 199.00, 3, '超值', 1),
('企业包', '团队协作首选', 5000, 399.00, 999.00, 4, NULL, 1),
('旗舰包', '无限创作可能', 10000, 699.00, 1999.00, 5, NULL, 1);


-- ============================================
-- Initialization Complete
-- ============================================
SELECT '========================================' AS '';
SELECT 'Database initialization completed!' AS message;
SELECT '========================================' AS '';
SELECT 'Default admin: admin (or admin@example.com) / 123456' AS credentials;
SELECT 'Demo user: demo (or demo@example.com) / 123456' AS credentials;
SELECT 'Initial credits: 1000' AS credits;
SELECT 'Credit packages: 5 packages created' AS packages;
SELECT '========================================' AS '';
SELECT 'IMPORTANT: Change default passwords after first login!' AS warning;
