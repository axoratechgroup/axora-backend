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
    currency VARCHAR(3) NOT NULL,
    amount NUMERIC(20, 8) NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

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
    amount NUMERIC(20, 8) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    origin VARCHAR(255),
    destination VARCHAR(255),
    destination_wallet_id UUID,
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_transaction_wallet
        FOREIGN KEY (wallet_id)
        REFERENCES wallets(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_transaction_destination_wallet
        FOREIGN KEY (destination_wallet_id)
        REFERENCES wallets(id)
        ON DELETE SET NULL,

    CONSTRAINT valid_transaction_type
        CHECK (type IN ('TOP_UP', 'TRANSFER', 'PAYMENT', 'SWAP')),

    CONSTRAINT valid_transaction_status
        CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'CANCELLED')),

    CONSTRAINT positive_transaction_amount
        CHECK (amount > 0)
);