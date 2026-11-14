

-- Create properties table
CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  title text NOT NULL,
  price numeric NOT NULL CHECK (price >= 0),
  location text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  bedrooms integer CHECK (bedrooms >= 0),
  bathrooms numeric CHECK (bathrooms >= 0),
  area numeric CHECK (area >= 0),
  description text NOT NULL,
  features text[] DEFAULT '{}',
  images text[] DEFAULT '{}',
  listing_type text NOT NULL CHECK (listing_type IN ('sale', 'rent', 'short-rent')),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);


-- Create saved_properties table
CREATE TABLE IF NOT EXISTS saved_properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, property_id)
);


-- Enable RLS
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;

ALTER TABLE saved_properties ENABLE ROW LEVEL SECURITY;


-- Policies for properties table
CREATE POLICY "Users can read all properties"
  ON properties
  FOR SELECT
  TO authenticated
  USING (true);


CREATE POLICY "Users can create their own properties"
  ON properties
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);


CREATE POLICY "Users can update their own properties"
  ON properties
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


CREATE POLICY "Users can delete their own properties"
  ON properties
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- Policies for saved_properties table
CREATE POLICY "Users can view their saved properties"
  ON saved_properties
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);


CREATE POLICY "Users can save properties"
  ON saved_properties
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);


CREATE POLICY "Users can unsave properties"
  ON saved_properties
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);


-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();

  RETURN NEW;

END;

$$ LANGUAGE plpgsql;


-- Create trigger for properties
CREATE TRIGGER update_properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();
;
