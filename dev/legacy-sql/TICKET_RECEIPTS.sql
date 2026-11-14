-- Ticket receipts persistence for buyer and event owner visibility
-- Run this in Supabase SQL editor

CREATE TABLE IF NOT EXISTS ticket_receipts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE NOT NULL,
  order_number TEXT NOT NULL,
  buyer_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  video_id UUID REFERENCES videos(id) ON DELETE SET NULL,
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  ticket_type TEXT,
  ticket_title TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  qr_code_data TEXT NOT NULL,
  ticket_image_url TEXT,
  pdf_url TEXT,
  seat_no TEXT,
  event_name TEXT,
  event_start_date TIMESTAMP WITH TIME ZONE,
  event_end_date TIMESTAMP WITH TIME ZONE,
  location_name TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  issued_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_receipts_buyer_id ON ticket_receipts(buyer_id);
CREATE INDEX IF NOT EXISTS idx_ticket_receipts_owner_id ON ticket_receipts(owner_id);
CREATE INDEX IF NOT EXISTS idx_ticket_receipts_order_id ON ticket_receipts(order_id);
CREATE INDEX IF NOT EXISTS idx_ticket_receipts_video_id ON ticket_receipts(video_id);
CREATE INDEX IF NOT EXISTS idx_ticket_receipts_event_id ON ticket_receipts(event_id);

ALTER TABLE ticket_receipts ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON ticket_receipts TO authenticated;
GRANT SELECT ON ticket_receipts TO anon;

DROP POLICY IF EXISTS "Users can read their bought tickets" ON ticket_receipts;
CREATE POLICY "Users can read their bought tickets"
  ON ticket_receipts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = buyer_id);

DROP POLICY IF EXISTS "Owners can read sold tickets" ON ticket_receipts;
CREATE POLICY "Owners can read sold tickets"
  ON ticket_receipts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Authenticated can insert own tickets" ON ticket_receipts;
CREATE POLICY "Authenticated can insert own tickets"
  ON ticket_receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = buyer_id);

DROP POLICY IF EXISTS "Owners can update sold tickets" ON ticket_receipts;
CREATE POLICY "Owners can update sold tickets"
  ON ticket_receipts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Helpful trigger to maintain updated_at
CREATE OR REPLACE FUNCTION update_ticket_receipts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trg_update_ticket_receipts_updated_at ON ticket_receipts;
CREATE TRIGGER trg_update_ticket_receipts_updated_at
  BEFORE UPDATE ON ticket_receipts
  FOR EACH ROW
  EXECUTE FUNCTION update_ticket_receipts_updated_at();