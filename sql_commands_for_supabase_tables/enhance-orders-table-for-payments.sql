-- Enhanced Orders Table for Payment Integration
-- This script enhances the existing orders table to better handle payment records
-- Run this in your Supabase SQL Editor

-- Add new columns to the orders table for better payment tracking
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS payment_provider TEXT CHECK (payment_provider IN ('internal', 'twint', 'paystack', 'worldline')),
ADD COLUMN IF NOT EXISTS payment_transaction_id TEXT,
ADD COLUMN IF NOT EXISTS payment_gateway_response JSONB,
ADD COLUMN IF NOT EXISTS payment_metadata JSONB,
ADD COLUMN IF NOT EXISTS platform_fee DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS processing_fee DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS refund_reason TEXT,
ADD COLUMN IF NOT EXISTS refund_date TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS payment_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_payment_attempt TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS payment_expires_at TIMESTAMP WITH TIME ZONE;

-- Create a separate payments table for detailed payment tracking
CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  payment_provider TEXT CHECK (payment_provider IN ('internal', 'twint', 'paystack', 'worldline')) NOT NULL,
  payment_method_id TEXT,
  amount DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded')) DEFAULT 'pending',
  transaction_id TEXT,
  gateway_reference TEXT,
  gateway_response JSONB,
  metadata JSONB,
  processing_fee DECIMAL(10,2) DEFAULT 0,
  net_amount DECIMAL(10,2),
  failure_reason TEXT,
  failure_code TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE
);

-- Create a payment methods table for storing user payment methods
CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  type TEXT CHECK (type IN ('credit_card', 'bank_account', 'paypal', 'twint', 'paystack', 'worldline')) NOT NULL,
  is_default BOOLEAN DEFAULT FALSE,
  nickname TEXT NOT NULL,
  last_four TEXT,
  expiry_date TEXT,
  card_type TEXT CHECK (card_type IN ('visa', 'mastercard', 'amex', 'discover')),
  bank_name TEXT,
  account_type TEXT CHECK (account_type IN ('checking', 'savings')),
  
  -- Twint specific fields
  twint_phone_number TEXT,
  
  -- Paystack specific fields
  paystack_email TEXT,
  paystack_auth_code TEXT,
  
  -- Worldline specific fields
  worldline_customer_id TEXT,
  worldline_payment_method_id TEXT,
  
  -- Additional metadata
  metadata JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider ON payments(payment_provider);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_transaction_id ON payments(transaction_id);

CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON payment_methods(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_type ON payment_methods(type);
CREATE INDEX IF NOT EXISTS idx_payment_methods_is_default ON payment_methods(is_default);
CREATE INDEX IF NOT EXISTS idx_payment_methods_is_active ON payment_methods(is_active);

-- Add indexes for new order columns
CREATE INDEX IF NOT EXISTS idx_orders_payment_provider ON orders(payment_provider);
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_payment_transaction_id ON orders(payment_transaction_id);

-- Create triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update triggers to new tables
DROP TRIGGER IF EXISTS update_payments_updated_at ON payments;
CREATE TRIGGER update_payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payment_methods_updated_at ON payment_methods;
CREATE TRIGGER update_payment_methods_updated_at
  BEFORE UPDATE ON payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Create a function to calculate net amount for payments
CREATE OR REPLACE FUNCTION calculate_payment_net_amount()
RETURNS TRIGGER AS $$
BEGIN
  NEW.net_amount = NEW.amount - NEW.processing_fee;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the net amount calculation trigger
DROP TRIGGER IF EXISTS trigger_calculate_payment_net_amount ON payments;
CREATE TRIGGER trigger_calculate_payment_net_amount
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION calculate_payment_net_amount();

-- Create a function to ensure only one default payment method per user
CREATE OR REPLACE FUNCTION ensure_single_default_payment_method()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_default = TRUE THEN
    -- Set all other payment methods for this user to not default
    UPDATE payment_methods 
    SET is_default = FALSE 
    WHERE user_id = NEW.user_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the single default payment method trigger
DROP TRIGGER IF EXISTS trigger_ensure_single_default_payment_method ON payment_methods;
CREATE TRIGGER trigger_ensure_single_default_payment_method
  BEFORE INSERT OR UPDATE ON payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_default_payment_method();

-- Create a function to update order payment status when payment status changes
CREATE OR REPLACE FUNCTION update_order_payment_status()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the order's payment status based on the payment status
  UPDATE orders 
  SET 
    payment_status = CASE 
      WHEN NEW.status = 'completed' THEN 'paid'
      WHEN NEW.status = 'failed' THEN 'failed'
      WHEN NEW.status = 'refunded' THEN 'refunded'
      ELSE 'pending'
    END,
    payment_transaction_id = NEW.transaction_id,
    payment_gateway_response = NEW.gateway_response,
    payment_metadata = NEW.metadata,
    updated_at = NOW()
  WHERE id = NEW.order_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply the order payment status update trigger
DROP TRIGGER IF EXISTS trigger_update_order_payment_status ON payments;
CREATE TRIGGER trigger_update_order_payment_status
  AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW
  EXECUTE FUNCTION update_order_payment_status();

-- Insert some sample payment methods for testing
INSERT INTO payment_methods (user_id, type, is_default, nickname, last_four, card_type, twint_phone_number, paystack_email, worldline_customer_id)
SELECT 
  p.id,
  'credit_card',
  true,
  'Default Card',
  '4242',
  'visa',
  NULL,
  NULL,
  NULL
FROM profiles p 
WHERE p.user_type = 'private'
LIMIT 5;

-- Insert sample Worldline payment methods
INSERT INTO payment_methods (user_id, type, is_default, nickname, worldline_customer_id, worldline_payment_method_id)
SELECT 
  p.id,
  'worldline',
  false,
  'Worldline Account',
  'cust_' || substr(md5(random()::text), 1, 9),
  'pm_' || substr(md5(random()::text), 1, 9)
FROM profiles p 
WHERE p.user_type = 'private'
LIMIT 3;

-- Insert sample Paystack payment methods
INSERT INTO payment_methods (user_id, type, is_default, nickname, paystack_email, paystack_auth_code)
SELECT 
  p.id,
  'paystack',
  false,
  'Paystack Account',
  p.email,
  'AUTH_' || substr(md5(random()::text), 1, 6)
FROM profiles p 
WHERE p.user_type = 'private'
LIMIT 3;

-- Insert sample Twint payment methods
INSERT INTO payment_methods (user_id, type, is_default, nickname, twint_phone_number)
SELECT 
  p.id,
  'twint',
  false,
  'Twint Account',
  '+4179' || floor(random() * 1000000)::text
FROM profiles p 
WHERE p.user_type = 'private'
LIMIT 3;

-- Create a view for order summary with payment information
CREATE OR REPLACE VIEW order_payment_summary AS
SELECT 
  o.id,
  o.order_number,
  o.user_id,
  o.total_amount,
  o.currency,
  o.status as order_status,
  o.payment_status,
  o.payment_provider,
  o.payment_transaction_id,
  o.platform_fee,
  o.processing_fee,
  o.created_at as order_created_at,
  p.id as payment_id,
  p.amount as payment_amount,
  p.status as payment_status_detail,
  p.transaction_id,
  p.gateway_reference,
  p.completed_at,
  p.failed_at,
  pm.type as payment_method_type,
  pm.nickname as payment_method_nickname
FROM orders o
LEFT JOIN payments p ON o.id = p.order_id
LEFT JOIN payment_methods pm ON p.payment_method_id = pm.id::text
ORDER BY o.created_at DESC;

-- Grant necessary permissions (adjust based on your RLS policies)
-- ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for payments table
-- CREATE POLICY "Users can view their own payments" ON payments
--   FOR SELECT USING (auth.uid() = user_id);

-- CREATE POLICY "Users can insert their own payments" ON payments
--   FOR INSERT WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can update their own payments" ON payments
--   FOR UPDATE USING (auth.uid() = user_id);

-- Create RLS policies for payment_methods table
-- CREATE POLICY "Users can view their own payment methods" ON payment_methods
--   FOR SELECT USING (auth.uid() = user_id);

-- CREATE POLICY "Users can insert their own payment methods" ON payment_methods
--   FOR INSERT WITH CHECK (auth.uid() = user_id);

-- CREATE POLICY "Users can update their own payment methods" ON payment_methods
--   FOR UPDATE USING (auth.uid() = user_id);

-- CREATE POLICY "Users can delete their own payment methods" ON payment_methods
--   FOR DELETE USING (auth.uid() = user_id);

COMMENT ON TABLE payments IS 'Detailed payment tracking for all payment providers';
COMMENT ON TABLE payment_methods IS 'User payment methods for different providers';
COMMENT ON VIEW order_payment_summary IS 'Summary view of orders with payment information';
