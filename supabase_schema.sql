-- Run this in the Supabase SQL editor after creating a project

CREATE TABLE IF NOT EXISTS hazard_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hazard_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description TEXT NOT NULL,
  confidence FLOAT DEFAULT 0,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  address TEXT,
  upvotes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for map queries
CREATE INDEX IF NOT EXISTS idx_hazard_reports_created_at ON hazard_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hazard_reports_location ON hazard_reports (lat, lng);

-- Enable Row Level Security
ALTER TABLE hazard_reports ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can view hazards)
CREATE POLICY "Anyone can read hazard reports"
  ON hazard_reports FOR SELECT
  USING (true);

-- Public insert access (anyone can submit reports)
CREATE POLICY "Anyone can insert hazard reports"
  ON hazard_reports FOR INSERT
  WITH CHECK (true);

-- Upvote update (anyone can increment upvotes)
CREATE POLICY "Anyone can upvote hazard reports"
  ON hazard_reports FOR UPDATE
  USING (true)
  WITH CHECK (true);
