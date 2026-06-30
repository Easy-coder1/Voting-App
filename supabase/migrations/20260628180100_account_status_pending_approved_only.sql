-- Restrict account_status to pending and approved only (no-op if already applied).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'account_status_type'
      AND e.enumlabel = 'rejected'
  ) THEN
    UPDATE public.profiles
    SET account_status = 'pending'
    WHERE account_status::text IN ('rejected', 'suspended');

    CREATE TYPE public.account_status_type_new AS ENUM ('pending', 'approved');

    ALTER TABLE public.profiles
      ALTER COLUMN account_status DROP DEFAULT;

    ALTER TABLE public.profiles
      ALTER COLUMN account_status TYPE public.account_status_type_new
      USING account_status::text::public.account_status_type_new;

    ALTER TABLE public.profiles
      ALTER COLUMN account_status SET DEFAULT 'pending';

    DROP TYPE public.account_status_type;
    ALTER TYPE public.account_status_type_new RENAME TO account_status_type;
  END IF;
END $$;
