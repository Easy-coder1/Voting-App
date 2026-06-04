-- Create custom types for enum-like behavior
CREATE TYPE account_status_type AS ENUM ('pending', 'approved', 'rejected', 'suspended');

-- Profiles table (extends Supabase auth.users)
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    role TEXT DEFAULT 'member' CHECK (role IN ('member', 'admin')),
    account_status account_status_type DEFAULT 'pending',
    voting_rights BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Elections table
CREATE TABLE elections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    start_date TIMESTAMPTZ NOT NULL,
    end_date TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'open', 'closed')),
    results_published BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Positions table
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    position_name TEXT NOT NULL UNIQUE
);

-- Insert default positions
INSERT INTO positions (position_name) VALUES
    ('President'),
    ('Vice President'),
    ('General Secretary'),
    ('Financial Secretary'),
    ('Welfare Secretary'),
    ('Male Organizer'),
    ('Female Organizer');

-- Candidates table
CREATE TABLE candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    position_id UUID REFERENCES positions(id) ON DELETE CASCADE,
    photo_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Votes table
CREATE TABLE votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voter_id UUID REFERENCES profiles(id) ON DELETE RESTRICT,
    candidate_id UUID REFERENCES candidates(id) ON DELETE RESTRICT,
    position_id UUID REFERENCES positions(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(voter_id, position_id) -- Ensures one vote per position per member
);

-- Audit logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Set up Row Level Security (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Profiles RLS
CREATE POLICY "Public profiles are viewable by everyone." ON profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile." ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile." ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can update all profiles." ON profiles FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Elections RLS
CREATE POLICY "Elections viewable by everyone." ON elections FOR SELECT USING (true);
CREATE POLICY "Admins can insert elections." ON elections FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update elections." ON elections FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can delete elections." ON elections FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Positions RLS
CREATE POLICY "Positions viewable by everyone." ON positions FOR SELECT USING (true);
CREATE POLICY "Admins can insert positions." ON positions FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update positions." ON positions FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Candidates RLS
CREATE POLICY "Candidates viewable by everyone." ON candidates FOR SELECT USING (true);
CREATE POLICY "Admins can insert candidates." ON candidates FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can update candidates." ON candidates FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Admins can delete candidates." ON candidates FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Votes RLS
-- Members can only read their own votes. Admins can read all votes.
CREATE POLICY "Members can view own votes, Admins can view all." ON votes FOR SELECT USING (
  auth.uid() = voter_id OR 
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Voting restrictions:
-- 1. Must be the authenticated user
-- 2. Must be approved and have voting rights
-- 3. Election must be open
CREATE POLICY "Members can insert vote if eligible." ON votes FOR INSERT WITH CHECK (
  auth.uid() = voter_id AND
  EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = auth.uid() 
      AND account_status = 'approved' 
      AND voting_rights = true
  ) AND
  EXISTS (
    SELECT 1 FROM elections
    WHERE status = 'open'
  )
);
-- No updates or deletes allowed on votes (immutable)

-- Audit Logs RLS
CREATE POLICY "Admins can view audit logs." ON audit_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "System can insert audit logs." ON audit_logs FOR INSERT WITH CHECK (true);

-- Triggers for User Creation (auto-create profile)
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.email, new.raw_user_meta_data->>'phone');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Enable Realtime for specific tables (useful for Admin dashboard)
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table votes;
