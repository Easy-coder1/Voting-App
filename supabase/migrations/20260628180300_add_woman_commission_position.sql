-- Add Woman Commission position (safe to re-run)
INSERT INTO public.positions (position_name)
VALUES ('Woman Commission')
ON CONFLICT (position_name) DO NOTHING;
