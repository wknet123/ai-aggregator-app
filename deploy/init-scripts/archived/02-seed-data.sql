-- ============================================
-- AI Aggregator Platform - Initial Data
-- ============================================

USE ai_aggregator;

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
    '$2b$12$Gwf0uvxH3L7JLfo0CC/Ic.QL3IZkDzn6U5VdnCLPzfNr5rqKp1vdq',
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
    '$2b$12$Gwf0uvxH3L7JLfo0CC/Ic.QL3IZkDzn6U5VdnCLPzfNr5rqKp1vdq',
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
    'recharge',
    1000,
    'completed',
    'Initial credit allocation for new account',
    (SELECT id FROM tenants WHERE slug = 'default')
);

-- ============================================
-- Initialization Complete
-- ============================================
SELECT 'Initial data seeded successfully!' AS message;
SELECT 'Default admin credentials: admin@example.com / 123456' AS note;
SELECT 'Demo user credentials: demo@example.com / 123456' AS note;
SELECT 'IMPORTANT: Please change these passwords after first login!' AS warning;
