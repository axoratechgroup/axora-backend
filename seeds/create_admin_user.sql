-- ============================================================
-- AXORA: Asignar rol de Administrador a admintest@axora.com
-- ============================================================

-- 1. Actualizar el rol del usuario a 'admin'
UPDATE users
SET role = 'admin'
WHERE email = 'admintest@axora.com';

-- 2. Asegurar que la billetera exista
INSERT INTO wallets (user_id)
SELECT id FROM users WHERE email = 'admintest@axora.com'
ON CONFLICT (user_id) DO NOTHING;

-- 3. Asegurar que existan los balances iniciales en 0 para todas las divisas
INSERT INTO balances (wallet_id, currency, amount)
SELECT w.id, c.code, 0
FROM wallets w
JOIN users u ON u.id = w.user_id
CROSS JOIN currencies c
WHERE u.email = 'admintest@axora.com'
ON CONFLICT (wallet_id, currency) DO NOTHING;
