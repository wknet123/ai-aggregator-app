-- 迁移脚本: 为 generation_tasks 表添加 is_public 列
-- 运行方式: mysql -u root -p ai_aggregator < scripts/add_is_public_column.sql

-- 添加 is_public 列 (如果不存在会报错，可忽略)
ALTER TABLE generation_tasks
ADD COLUMN is_public INT NOT NULL DEFAULT 0 AFTER is_favorite;

-- 为 is_public 列添加索引
ALTER TABLE generation_tasks
ADD INDEX idx_generation_tasks_is_public (is_public);

-- 验证更改
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'generation_tasks'
AND COLUMN_NAME = 'is_public';
