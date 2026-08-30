-- ============================================
-- AXORA - Database Schema
-- ============================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";



-- ============================================
-- CURRENCIES
-- ============================================

CREATE TABLE currencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    symbol VARCHAR(10),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================
-- USERS
-- ============================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- WALLETS
-- ============================================

CREATE TABLE wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_wallet_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

-- ============================================
-- BALANCES
-- ============================================

CREATE TABLE balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL,
    currency VARCHAR(10) NOT NULL,
    amount NUMERIC(20, 8) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_balance_currency
        FOREIGN KEY (currency)
        REFERENCES currencies(code)
        ON DELETE RESTRICT,

    CONSTRAINT fk_balance_wallet
        FOREIGN KEY (wallet_id)
        REFERENCES wallets(id)
        ON DELETE CASCADE,

    CONSTRAINT unique_wallet_currency
        UNIQUE (wallet_id, currency),

    CONSTRAINT positive_balance
        CHECK (amount >= 0)
);

-- ============================================
-- TRANSACTIONS
-- ============================================

CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL,
    type VARCHAR(20) NOT NULL,

    from_currency VARCHAR(10),
    from_amount  NUMERIC(20, 8),
    from_balance_before NUMERIC(20, 8),
    from_balance_after NUMERIC(20, 8),

    to_currency VARCHAR(10) NOT NULL,
    to_amount NUMERIC(20, 8) NOT NULL,
    to_balance_before NUMERIC(20, 8) NOT NULL,
    to_balance_after NUMERIC(20, 8) NOT NULL,

    applied_exchange_rate NUMERIC(20, 8),

    origin VARCHAR(255),
    destination VARCHAR(255),
    destination_wallet_id UUID,

    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    metadata JSONB,
    description VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_transaction_wallet
        FOREIGN KEY (wallet_id)
        REFERENCES wallets(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_transaction_destination_wallet
        FOREIGN KEY (destination_wallet_id)
        REFERENCES wallets(id)
        ON DELETE RESTRICT,

    CONSTRAINT fk_transaction_from_currency
        FOREIGN KEY (from_currency)
        REFERENCES currencies(code)
        ON DELETE RESTRICT,

    CONSTRAINT fk_transaction_to_currency
        FOREIGN KEY (to_currency)
        REFERENCES currencies(code)
        ON DELETE RESTRICT,

    CONSTRAINT valid_transaction_type
        CHECK (type IN ('TOP_UP', 'BUY', 'SELL', 'SWAP', 'TRANSFER')),

    CONSTRAINT valid_transaction_status
        CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')),

    CONSTRAINT positive_from_amount
        CHECK (from_amount IS NULL OR from_amount > 0),

    CONSTRAINT positive_to_amount
        CHECK (to_amount > 0),

    CONSTRAINT chk_transaction_sides
        CHECK (
            (type = 'TOP_UP' AND from_currency IS NULL AND from_amount IS NULL
                AND from_balance_before IS NULL AND from_balance_after IS NULL
                AND applied_exchange_rate IS NULL AND destination_wallet_id IS NULL)
            OR
            (type = 'TRANSFER' AND from_currency IS NOT NULL AND from_amount IS NOT NULL
                AND from_balance_before IS NOT NULL AND from_balance_after IS NOT NULL
                AND applied_exchange_rate IS NULL AND destination_wallet_id IS NOT NULL
                AND from_currency = to_currency AND from_amount = to_amount)
            OR
            (type IN ('BUY', 'SELL', 'SWAP') AND from_currency IS NOT NULL AND from_amount IS NOT NULL
                AND from_balance_before IS NOT NULL AND from_balance_after IS NOT NULL
                AND applied_exchange_rate IS NOT NULL AND destination_wallet_id IS NULL)
        ),

    CONSTRAINT chk_no_self_transfer
        CHECK (destination_wallet_id IS NULL OR destination_wallet_id <> wallet_id)
);

-- ============================================
-- EXCHANGE_RATES
-- ============================================

CREATE TABLE exchange_rates (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_currency VARCHAR(10) NOT NULL REFERENCES currencies(code),
    to_currency   VARCHAR(10) NOT NULL REFERENCES currencies(code),
    rate          NUMERIC(20, 8) NOT NULL,
    source        VARCHAR(100) NOT NULL,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL,
    UNIQUE(from_currency, to_currency)
);

-- ============================================
-- NOTIFICATION_OUTBOX
-- ============================================

CREATE TABLE notification_outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_id  UUID NOT NULL REFERENCES transactions(id),
    recipient_email VARCHAR(255) NOT NULL,
    type            VARCHAR(50) NOT NULL DEFAULT 'TRANSACTION_CONFIRMATION'
                        CHECK (type IN ('TRANSACTION_CONFIRMATION')),
    status          VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED')),
    attempts        INT NOT NULL DEFAULT 0,
    last_error      VARCHAR(500),
    sent_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(transaction_id, type)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_transactions_wallet_id             ON transactions(wallet_id);
CREATE INDEX idx_transactions_destination_wallet_id ON transactions(destination_wallet_id);
CREATE INDEX idx_notification_outbox_status         ON notification_outbox(status);

-- ============================================
-- TRIGGERS
-- ============================================

-- Función genérica: actualiza updated_at a la hora actual en cualquier UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_balances_set_updated_at
    BEFORE UPDATE ON balances
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notification_outbox_set_updated_at
    BEFORE UPDATE ON notification_outbox
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
