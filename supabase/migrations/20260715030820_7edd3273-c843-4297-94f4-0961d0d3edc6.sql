
-- Enums
CREATE TYPE public.queue_category AS ENUM ('pasang_baru', 'gangguan', 'tagihan');
CREATE TYPE public.queue_status AS ENUM ('waiting', 'serving', 'done', 'skipped');
CREATE TYPE public.admin_role AS ENUM ('admin_pasang_baru', 'admin_gangguan', 'admin_tagihan');

-- Map category -> admin role
CREATE OR REPLACE FUNCTION public.role_for_category(_cat public.queue_category)
RETURNS public.admin_role
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE _cat
    WHEN 'pasang_baru' THEN 'admin_pasang_baru'::public.admin_role
    WHEN 'gangguan' THEN 'admin_gangguan'::public.admin_role
    WHEN 'tagihan' THEN 'admin_tagihan'::public.admin_role
  END
$$;

-- Tickets
CREATE TABLE public.queue_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category public.queue_category NOT NULL,
  ticket_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Jakarta')::date,
  number integer NOT NULL,
  code text NOT NULL,
  customer_name text NOT NULL,
  meter_number text NOT NULL,
  status public.queue_status NOT NULL DEFAULT 'waiting',
  created_at timestamptz NOT NULL DEFAULT now(),
  served_at timestamptz,
  finished_at timestamptz,
  UNIQUE (category, ticket_date, number)
);

CREATE INDEX idx_queue_tickets_cat_status ON public.queue_tickets(category, status, number);
CREATE INDEX idx_queue_tickets_date ON public.queue_tickets(ticket_date);

GRANT SELECT, INSERT ON public.queue_tickets TO anon;
GRANT SELECT, INSERT, UPDATE ON public.queue_tickets TO authenticated;
GRANT ALL ON public.queue_tickets TO service_role;

ALTER TABLE public.queue_tickets ENABLE ROW LEVEL SECURITY;

-- Anyone can read tickets (needed for customer's "now serving" display)
CREATE POLICY "Public can view tickets"
  ON public.queue_tickets FOR SELECT
  USING (true);

-- Anyone can create tickets
CREATE POLICY "Public can create tickets"
  ON public.queue_tickets FOR INSERT
  WITH CHECK (true);

-- User roles
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.admin_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- has_role security-definer helper
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.admin_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Admins can update tickets in their category
CREATE POLICY "Admins can update tickets in their category"
  ON public.queue_tickets FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), public.role_for_category(category)))
  WITH CHECK (public.has_role(auth.uid(), public.role_for_category(category)));

-- Trigger: auto-assign next number+code per category per day
CREATE OR REPLACE FUNCTION public.assign_ticket_number()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  next_num integer;
  prefix text;
BEGIN
  IF NEW.ticket_date IS NULL THEN
    NEW.ticket_date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  END IF;

  SELECT COALESCE(MAX(number), 0) + 1
    INTO next_num
    FROM public.queue_tickets
    WHERE category = NEW.category AND ticket_date = NEW.ticket_date;

  NEW.number := next_num;
  prefix := CASE NEW.category
    WHEN 'pasang_baru' THEN 'A'
    WHEN 'gangguan' THEN 'B'
    WHEN 'tagihan' THEN 'C'
  END;
  NEW.code := prefix || '-' || LPAD(next_num::text, 2, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_assign_ticket_number
  BEFORE INSERT ON public.queue_tickets
  FOR EACH ROW EXECUTE FUNCTION public.assign_ticket_number();

-- Realtime
ALTER TABLE public.queue_tickets REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_tickets;
