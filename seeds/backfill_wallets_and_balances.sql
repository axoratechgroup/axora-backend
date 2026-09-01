-- Backfill: crea wallets y balances faltantes para usuarios que se
-- registraron antes de que existieran esas features.
-- Es seguro correrlo mas de una vez: usa NOT EXISTS, asi que nunca duplica
-- una wallet ni una balance que ya exista.

BEGIN;

INSERT INTO wallets (user_id)
SELECT u.id
FROM users u
WHERE NOT EXISTS (
    SELECT 1 FROM wallets w WHERE w.user_id = u.id
);

INSERT INTO balances (wallet_id, currency, amount)
SELECT w.id, c.code, 0
FROM wallets w
CROSS JOIN currencies c
WHERE NOT EXISTS (
    SELECT 1 FROM balances b
    WHERE b.wallet_id = w.id AND b.currency = c.code
);

COMMIT;
