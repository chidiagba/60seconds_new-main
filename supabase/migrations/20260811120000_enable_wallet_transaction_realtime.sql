-- Organizer wallet screens subscribe to these rows so completed payment
-- settlements appear without requiring a manual refresh.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'transactions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'wallets'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
  END IF;
END
$$;
