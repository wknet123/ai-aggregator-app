-- ============================================
-- AI Aggregator Platform - Database Schema
-- MySQL 8.0+ Compatible
-- ============================================

-- Use the database
USE ai_aggregator;

-- ============================================
-- Tenants Table (Multi-tenant architecture)
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
-- Users Table
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
-- Credits Table
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
-- Transactions Table
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    type ENUM('recharge', 'consumption', 'refund', 'adjustment') NOT NULL,
    amount INT NOT NULL,
    status ENUM('pending', 'completed', 'failed', 'cancelled') DEFAULT 'pending' NOT NULL,
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
-- API Keys Table
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
-- Model Usages Table
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
-- Workflow Instances Table
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
-- Workflow Steps Table
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_steps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    workflow_id INT NOT NULL,
    step_index INT NOT NULL,
    step_type ENUM('TEXT_TO_IMAGE', 'IMAGE_TO_VIDEO', 'VIDEO_TO_3D') NOT NULL,
    status ENUM('PENDING', 'PROCESSING', 'AWAITING_CONFIRMATION', 'COMPLETED', 'FAILED') DEFAULT 'PENDING' NOT NULL,
    model_id VARCHAR(100) NOT NULL,
    input_data JSON,
    output_data JSON,
    is_optional BOOLEAN DEFAULT FALSE NOT NULL,
    cost VARCHAR(20) DEFAULT '0' NOT NULL,
    error_message TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (workflow_id) REFERENCES workflow_instances(id) ON DELETE CASCADE,
    INDEX idx_workflow_steps_workflow_id (workflow_id),
    INDEX idx_workflow_steps_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Generation Tasks Table
-- ============================================
CREATE TABLE IF NOT EXISTS generation_tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    task_id VARCHAR(64) UNIQUE NOT NULL,
    user_id INT NOT NULL,
    tenant_id INT NOT NULL,
    model_id VARCHAR(50) NOT NULL,
    task_type VARCHAR(20) NOT NULL,
    prompt TEXT NOT NULL,
    parameters TEXT,
    status VARCHAR(20) DEFAULT 'pending' NOT NULL,
    progress INT DEFAULT 0,
    result_path VARCHAR(500),
    result_url VARCHAR(500),
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at DATETIME,
    INDEX idx_generation_tasks_task_id (task_id),
    INDEX idx_generation_tasks_user_id (user_id),
    INDEX idx_generation_tasks_tenant_id (tenant_id),
    INDEX idx_generation_tasks_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- Initialization Complete Message
-- ============================================
SELECT 'Database schema created successfully!' AS message;
