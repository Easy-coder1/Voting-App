-- Allow admins to reject pending registrations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'account_status_type'
      AND e.enumlabel = 'rejected'
  ) THEN
    ALTER TYPE public.account_status_type ADD VALUE 'rejected';
  END IF;
END $$;
