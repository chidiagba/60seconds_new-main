-- ==============================================
-- WALLET AND PAYMENT SYSTEM TABLES
-- 60Seconds App - Wallet & Payment Integration
-- ==============================================
-- This script creates the missing wallet and payment system tables
-- Run this in your Supabase SQL Editor

-- ==============================================
-- STEP 1: CREATE WALLETS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  balance DECIMAL(15,2) DEFAULT 0.00,
  currency TEXT DEFAULT 'USD',
  is_verified BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ==============================================
-- STEP 2: CREATE TRANSACTIONS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  type TEXT CHECK (type IN ('deposit', 'withdrawal', 'payment', 'transfer', 'fee', 'refund')) NOT NULL,
  status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
  description TEXT NOT NULL,
  transaction_fee DECIMAL(15,2) DEFAULT 0.00,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- STEP 3: CREATE PAYMENT METHODS TABLE (if not exists)
-- ==============================================

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

-- ==============================================
-- STEP 4: CREATE BUSINESS BANK ACCOUNTS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS business_bank_accounts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  bank_name TEXT NOT NULL,
  account_holder_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  routing_number TEXT,
  iban TEXT,
  swift_code TEXT,
  country TEXT NOT NULL,
  currency TEXT DEFAULT 'USD',
  is_verified BOOLEAN DEFAULT FALSE,
  is_primary BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ==============================================
-- STEP 5: CREATE WITHDRAWAL REQUESTS TABLE
-- ==============================================

CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
  business_bank_account_id UUID REFERENCES business_bank_accounts(id) ON DELETE SET NULL,
  processing_fee DECIMAL(15,2) DEFAULT 0.00,
  net_amount DECIMAL(15,2),
  failure_reason TEXT,
  processed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==============================================
-- STEP 6: CREATE INDEXES FOR PERFORMANCE
-- ==============================================

-- Wallets indexes
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_is_active ON wallets(is_active);
CREATE INDEX IF NOT EXISTS idx_wallets_created_at ON wallets(created_at DESC);

-- Transactions indexes
CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_amount ON transactions(amount);

-- Payment methods indexes
CREATE INDEX IF NOT EXISTS idx_payment_methods_user_id ON payment_methods(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_type ON payment_methods(type);
CREATE INDEX IF NOT EXISTS idx_payment_methods_is_default ON payment_methods(is_default);
CREATE INDEX IF NOT EXISTS idx_payment_methods_is_active ON payment_methods(is_active);

-- Business bank accounts indexes
CREATE INDEX IF NOT EXISTS idx_business_bank_accounts_user_id ON business_bank_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_business_bank_accounts_is_verified ON business_bank_accounts(is_verified);
CREATE INDEX IF NOT EXISTS idx_business_bank_accounts_is_primary ON business_bank_accounts(is_primary);
CREATE INDEX IF NOT EXISTS idx_business_bank_accounts_is_active ON business_bank_accounts(is_active);

-- Withdrawal requests indexes
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_user_id ON withdrawal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_status ON withdrawal_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawal_requests_created_at ON withdrawal_requests(created_at DESC);

-- ==============================================
-- STEP 7: CREATE TRIGGER FUNCTIONS
-- ==============================================

-- Update timestamps trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to ensure only one default payment method per user
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

-- Function to calculate net amount for withdrawal requests
CREATE OR REPLACE FUNCTION calculate_withdrawal_net_amount()
RETURNS TRIGGER AS $$
BEGIN
  NEW.net_amount = NEW.amount - NEW.processing_fee;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================
-- STEP 8: CREATE TRIGGERS
-- ==============================================

-- Update triggers for all tables
DROP TRIGGER IF EXISTS update_wallets_updated_at ON wallets;
CREATE TRIGGER update_wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
CREATE TRIGGER update_transactions_updated_at
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_payment_methods_updated_at ON payment_methods;
CREATE TRIGGER update_payment_methods_updated_at
  BEFORE UPDATE ON payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_business_bank_accounts_updated_at ON business_bank_accounts;
CREATE TRIGGER update_business_bank_accounts_updated_at
  BEFORE UPDATE ON business_bank_accounts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_withdrawal_requests_updated_at ON withdrawal_requests;
CREATE TRIGGER update_withdrawal_requests_updated_at
  BEFORE UPDATE ON withdrawal_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Single default payment method trigger
DROP TRIGGER IF EXISTS trigger_ensure_single_default_payment_method ON payment_methods;
CREATE TRIGGER trigger_ensure_single_default_payment_method
  BEFORE INSERT OR UPDATE ON payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION ensure_single_default_payment_method();

-- Net amount calculation trigger for withdrawal requests
DROP TRIGGER IF EXISTS trigger_calculate_withdrawal_net_amount ON withdrawal_requests;
CREATE TRIGGER trigger_calculate_withdrawal_net_amount
  BEFORE INSERT OR UPDATE ON withdrawal_requests
  FOR EACH ROW
  EXECUTE FUNCTION calculate_withdrawal_net_amount();

-- ==============================================
-- STEP 9: ENABLE ROW LEVEL SECURITY
-- ==============================================

ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawal_requests ENABLE ROW LEVEL SECURITY;

-- ==============================================
-- STEP 10: CREATE RLS POLICIES
-- ==============================================

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view their own wallets" ON wallets;
DROP POLICY IF EXISTS "Users can update their own wallets" ON wallets;
DROP POLICY IF EXISTS "Users can insert their own wallets" ON wallets;

DROP POLICY IF EXISTS "Users can view their own transactions" ON transactions;
DROP POLICY IF EXISTS "Users can insert their own transactions" ON transactions;

DROP POLICY IF EXISTS "Users can view their own payment methods" ON payment_methods;
DROP POLICY IF EXISTS "Users can insert their own payment methods" ON payment_methods;
DROP POLICY IF EXISTS "Users can update their own payment methods" ON payment_methods;
DROP POLICY IF EXISTS "Users can delete their own payment methods" ON payment_methods;

DROP POLICY IF EXISTS "Users can view their own business bank accounts" ON business_bank_accounts;
DROP POLICY IF EXISTS "Users can insert their own business bank accounts" ON business_bank_accounts;
DROP POLICY IF EXISTS "Users can update their own business bank accounts" ON business_bank_accounts;

DROP POLICY IF EXISTS "Users can view their own withdrawal requests" ON withdrawal_requests;
DROP POLICY IF EXISTS "Users can insert their own withdrawal requests" ON withdrawal_requests;
DROP POLICY IF EXISTS "Users can update their own withdrawal requests" ON withdrawal_requests;

-- Wallets RLS Policies
CREATE POLICY "Users can view their own wallets" ON wallets
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update their own wallets" ON wallets
  FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert their own wallets" ON wallets
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

-- Transactions RLS Policies
CREATE POLICY "Users can view their own transactions" ON transactions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM wallets w 
      WHERE w.id = transactions.wallet_id 
      AND w.user_id::text = auth.uid()::text
    )
  );

CREATE POLICY "Users can insert their own transactions" ON transactions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM wallets w 
      WHERE w.id = transactions.wallet_id 
      AND w.user_id::text = auth.uid()::text
    )
  );

-- Payment Methods RLS Policies
CREATE POLICY "Users can view their own payment methods" ON payment_methods
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert their own payment methods" ON payment_methods
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update their own payment methods" ON payment_methods
  FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can delete their own payment methods" ON payment_methods
  FOR DELETE USING (auth.uid()::text = user_id::text);

-- Business Bank Accounts RLS Policies
CREATE POLICY "Users can view their own business bank accounts" ON business_bank_accounts
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert their own business bank accounts" ON business_bank_accounts
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update their own business bank accounts" ON business_bank_accounts
  FOR UPDATE USING (auth.uid()::text = user_id::text);

-- Withdrawal Requests RLS Policies
CREATE POLICY "Users can view their own withdrawal requests" ON withdrawal_requests
  FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can insert their own withdrawal requests" ON withdrawal_requests
  FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update their own withdrawal requests" ON withdrawal_requests
  FOR UPDATE USING (auth.uid()::text = user_id::text);

-- ==============================================
-- STEP 11: GRANT PERMISSIONS
-- ==============================================

-- Grant permissions to authenticated users
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- ==============================================
-- STEP 12: INSERT SAMPLE DATA (Optional)
-- ==============================================

-- Create wallets for existing users
INSERT INTO wallets (user_id, balance, currency, is_verified)
SELECT 
  p.id,
  0.00,
  'USD',
  false
FROM profiles p 
WHERE NOT EXISTS (
  SELECT 1 FROM wallets w WHERE w.user_id = p.id
);

-- ==============================================
-- COMPLETION MESSAGE
-- ==============================================

SELECT 
  '🎉 WALLET SYSTEM SETUP COMPLETE!' as status,
  'All wallet and payment tables have been created successfully.' as message,
  'Your wallet system is now ready for use!' as next_step;











