-- ============================================
-- 支付系统增量SQL脚本
-- 适用于: MySQL 5.7+ / 8.0+
-- 生成时间: 2026-01-12
-- 描述: 创建支付相关表及初始化数据
-- ============================================

-- ============================================
-- 1. 创建积分套餐表 credit_packages
-- ============================================
CREATE TABLE IF NOT EXISTS `credit_packages` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `name` VARCHAR(100) NOT NULL COMMENT '套餐名称',
    `description` VARCHAR(500) DEFAULT NULL COMMENT '套餐描述',
    `credits` INT NOT NULL COMMENT '包含积分数量',
    `price` DECIMAL(10, 2) NOT NULL COMMENT '价格（元）',
    `original_price` DECIMAL(10, 2) DEFAULT NULL COMMENT '原价（用于显示折扣）',
    `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
    `sort_order` INT DEFAULT 0 COMMENT '排序顺序',
    `badge` VARCHAR(50) DEFAULT NULL COMMENT '徽章标签（如：热门、推荐）',
    PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='积分套餐表';


-- ============================================
-- 2. 创建支付订单表 payment_orders
-- ============================================
CREATE TABLE IF NOT EXISTS `payment_orders` (
    `id` INT NOT NULL AUTO_INCREMENT,
    `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    -- 订单基本信息
    `order_no` VARCHAR(64) NOT NULL COMMENT '订单号',
    `tenant_id` INT NOT NULL COMMENT '租户ID',
    `user_id` INT NOT NULL COMMENT '用户ID',
    
    -- 套餐信息
    `package_id` INT NOT NULL COMMENT '套餐ID',
    `package_name` VARCHAR(100) NOT NULL COMMENT '套餐名称（冗余字段）',
    `credits` INT NOT NULL COMMENT '购买积分数量',
    
    -- 支付信息
    `amount` DECIMAL(10, 2) NOT NULL COMMENT '支付金额（元）',
    `payment_method` ENUM('ALIPAY', 'WECHAT', 'MANUAL') NOT NULL COMMENT '支付方式',
    `status` ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'REFUNDED', 'CANCELLED') NOT NULL DEFAULT 'PENDING' COMMENT '支付状态',
    
    -- 第三方支付信息
    `trade_no` VARCHAR(128) DEFAULT NULL COMMENT '第三方交易号',
    `qr_code` TEXT DEFAULT NULL COMMENT '支付二维码内容',
    
    -- 回调信息
    `notify_time` DATETIME DEFAULT NULL COMMENT '通知时间',
    `notify_data` TEXT DEFAULT NULL COMMENT '回调通知数据（JSON）',
    
    -- 时间戳
    `paid_at` DATETIME DEFAULT NULL COMMENT '支付完成时间',
    `expired_at` DATETIME DEFAULT NULL COMMENT '过期时间',
    
    -- 备注
    `remark` VARCHAR(500) DEFAULT NULL COMMENT '备注',
    `error_message` VARCHAR(500) DEFAULT NULL COMMENT '错误信息',
    
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_order_no` (`order_no`),
    UNIQUE KEY `uk_trade_no` (`trade_no`),
    KEY `idx_tenant_id` (`tenant_id`),
    KEY `idx_user_id` (`user_id`),
    KEY `idx_status` (`status`),
    KEY `idx_created_at` (`created_at`),
    
    CONSTRAINT `fk_payment_orders_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_payment_orders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT `fk_payment_orders_package` FOREIGN KEY (`package_id`) REFERENCES `credit_packages` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='支付订单表';


-- ============================================
-- 3. 初始化默认积分套餐数据
-- ============================================
-- 使用INSERT IGNORE避免重复插入
INSERT IGNORE INTO `credit_packages` (`name`, `description`, `credits`, `price`, `original_price`, `sort_order`, `badge`, `is_active`) VALUES
('体验包', '新手入门首选', 100, 9.90, 19.90, 1, '推荐', 1),
('标准包', '日常创作足够', 500, 49.00, 99.00, 2, '热门', 1),
('专业包', '高频使用优选', 1000, 89.00, 199.00, 3, '超值', 1),
('企业包', '团队协作首选', 5000, 399.00, 999.00, 4, NULL, 1),
('旗舰包', '无限创作可能', 10000, 699.00, 1999.00, 5, NULL, 1);


-- ============================================
-- 4. 验证脚本执行结果
-- ============================================
-- 查看创建的表结构
-- DESCRIBE credit_packages;
-- DESCRIBE payment_orders;

-- 查看套餐数据
-- SELECT * FROM credit_packages ORDER BY sort_order;

-- 查看订单表索引
-- SHOW INDEX FROM payment_orders;
