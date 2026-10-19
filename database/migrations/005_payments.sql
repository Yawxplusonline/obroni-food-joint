-- =============================================================================
-- OpenFood Delivery Platform — Migration 005: Mobile Money & Bank Card Payments
-- =============================================================================
-- Adds payment method, payment status, and transaction reference tracking
-- to the `orders` table so customers can pay via Mobile Money or Bank Card
-- after placing an order, and restaurants can confirm payment in real time.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_method_type') THEN
    CREATE TYPE payment_method_type AS ENUM (
      'MOMO_MTN',
      'MOMO_TELECEL',
      'MOMO_AT',
      'BANK_CARD'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status_type') THEN
    CREATE TYPE payment_status_type AS ENUM (
      'UNPAID',
      'PAID_PENDING_CONFIRMATION',
      'CONFIRMED',
      'REFUNDED'
    );
  END IF;
END $$;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_method payment_method_type DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_status payment_status_type DEFAULT 'UNPAID',
  ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(100) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_account VARCHAR(50) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP WITH TIME ZONE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS payment_confirmed_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
