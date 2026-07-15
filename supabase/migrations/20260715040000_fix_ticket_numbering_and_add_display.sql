/*
# Fix ticket numbering race condition + enforce single-serving-per-category

Problem being fixed:
- The original `assign_ticket_number` trigger used
  `SELECT COALESCE(MAX(number),0)+1 FROM queue_tickets WHERE category=... AND ticket_date=...`
  inside a BEFORE INSERT trigger. Two concurrent submissions in the same
  category/day can both read the same MAX(number) before either commits,
  producing two rows that collide on the UNIQUE(category, ticket_date, number)
  constraint. One of the two customer submissions then hard-fails with a
  duplicate-key error instead of retrying — a real failure mode under load
  (e.g. two customers tapping submit close together during a busy morning).

Fix:
- Introduce a `queue_counters` table (category, counter_date, last_number) and
  an atomic `next_ticket_number()` helper using INSERT ... ON CONFLICT DO UPDATE
  ... RETURNING, which Postgres guarantees is race-free under concurrent
  transactions (row-level lock on the conflicting row). The trigger now calls
  this helper instead of doing its own MAX() scan.

Also fixing:
- No constraint currently stops two tickets in the same category from both
  being 'serving' simultaneously (possible if callNext is invoked twice
  concurrently, e.g. double-click before the button disables, or two admin
  tabs open). Adding a partial unique index prevents this at the DB level
  regardless of what the application code does.
*/

-- ===================== Atomic per-category-per-day counter =====================
CREATE TABLE IF NOT EXISTS public.queue_counters (
  category public.queue_category NOT NULL,
  counter_date date NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  PRIMARY KEY (category, counter_date)
);

ALTER TABLE public.queue_counters ENABLE ROW LEVEL SECURITY;
-- No direct table grants: only accessed via the SECURITY DEFINER function below.
REVOKE ALL ON public.queue_counters FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.next_ticket_number(p_category public.queue_category, p_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO public.queue_counters (category, counter_date, last_number)
  VALUES (p_category, p_date, 1)
  ON CONFLICT (category, counter_date)
  DO UPDATE SET last_number = queue_counters.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.next_ticket_number(public.queue_category, date) FROM PUBLIC, anon, authenticated;
-- Only the trigger function (running as its definer) needs to call this.

-- ===================== Replace the racy trigger with the atomic version =====================
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

  next_num := public.next_ticket_number(NEW.category, NEW.ticket_date);

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
-- Trigger `trg_assign_ticket_number` already points at this function name,
-- so CREATE OR REPLACE above is sufficient — no need to re-create the trigger.

-- ===================== Prevent two simultaneous "serving" tickets per category =====================
-- Using a partial unique index instead of a CHECK constraint because CHECK
-- constraints can't reference other rows; a partial unique index enforces
-- "at most one row per category with status = 'serving'" across the whole table.
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_serving_per_category
  ON public.queue_tickets (category)
  WHERE status = 'serving';

-- ===================== Atomic "call next" RPC =====================
-- The application previously did this as two separate round-trips from the
-- server function (mark current as done, then select+promote next). Under
-- concurrent calls (double-click, two admin tabs on the same category) both
-- could pass the "not currently serving" check before either commits, and the
-- second one would now hit the unique index above as a hard error. Doing the
-- whole operation inside one PL/pgSQL function means it runs as a single
-- transaction with row locking (`FOR UPDATE SKIP LOCKED`), so a concurrent
-- second call simply finds no eligible row instead of racing.
CREATE OR REPLACE FUNCTION public.call_next_ticket(p_category public.queue_category)
RETURNS TABLE (id uuid, code text, customer_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_id uuid;
BEGIN
  -- This function is SECURITY DEFINER, which bypasses the RLS policy that
  -- normally restricts UPDATEs to admins whose role matches queues.category.
  -- The TypeScript wrapper (callNext in queue.functions.ts) always derives
  -- p_category from the caller's own role, so the app UI never sends a
  -- mismatched category — but that only protects against the app's own UI,
  -- not against this RPC being called directly (Supabase client, devtools,
  -- a valid JWT via curl). Re-check authorization here so the function is
  -- safe to call on its own, independent of what the app does.
  IF NOT public.has_role(auth.uid(), public.role_for_category(p_category)) THEN
    RAISE EXCEPTION 'Not authorized to call tickets in this category';
  END IF;

  UPDATE public.queue_tickets
  SET status = 'done', finished_at = now()
  WHERE category = p_category AND status = 'serving';

  SELECT qt.id INTO v_next_id
  FROM public.queue_tickets qt
  WHERE qt.category = p_category AND qt.status = 'waiting'
  ORDER BY qt.number ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_next_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.queue_tickets
  SET status = 'serving', served_at = now()
  WHERE queue_tickets.id = v_next_id
  RETURNING queue_tickets.id, queue_tickets.code, queue_tickets.customer_name;
END;
$$;

REVOKE ALL ON FUNCTION public.call_next_ticket(public.queue_category) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.call_next_ticket(public.queue_category) TO authenticated, service_role;

-- ===================== Atomic "skip ticket" RPC =====================
-- Previously skipTicket() just set the target row's status to 'skipped'
-- regardless of whether it was 'waiting' or 'serving'. If an admin skipped
-- the *currently serving* ticket (the "Lewati Antrean Ini" button in the
-- dashboard does exactly this), no ticket would be promoted to fill the
-- now-empty serving slot — the admin had to remember to separately click
-- "Panggil Nomor Selanjutnya". In the meantime the display board and any
-- customer watching would show "Sedang Dilayani: —" even though people are
-- still waiting, which reads as the system being broken.
--
-- This RPC skips the target ticket and, if it was the one being served,
-- atomically promotes the next waiting ticket in the same transaction —
-- mirroring call_next_ticket's locking so it's safe under concurrent calls.
CREATE OR REPLACE FUNCTION public.skip_ticket(p_ticket_id uuid)
RETURNS TABLE (id uuid, code text, customer_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category public.queue_category;
  v_was_serving boolean;
  v_next_id uuid;
BEGIN
  SELECT category, (status = 'serving')
    INTO v_category, v_was_serving
    FROM public.queue_tickets
    WHERE queue_tickets.id = p_ticket_id
    FOR UPDATE;

  IF v_category IS NULL THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- This function is SECURITY DEFINER, which bypasses the RLS policy that
  -- normally restricts UPDATEs to admins whose role matches the ticket's
  -- category. Re-check that permission explicitly here, otherwise any
  -- authenticated admin (of ANY category) could skip tickets belonging to a
  -- category they don't manage.
  IF NOT public.has_role(auth.uid(), public.role_for_category(v_category)) THEN
    RAISE EXCEPTION 'Not authorized to skip tickets in this category';
  END IF;

  UPDATE public.queue_tickets
  SET status = 'skipped', finished_at = now()
  WHERE queue_tickets.id = p_ticket_id;

  IF NOT v_was_serving THEN
    RETURN;
  END IF;

  -- The skipped ticket was the one being served, so promote the next
  -- waiting ticket in its category to fill the now-empty serving slot.
  SELECT qt.id INTO v_next_id
  FROM public.queue_tickets qt
  WHERE qt.category = v_category AND qt.status = 'waiting'
  ORDER BY qt.number ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_next_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.queue_tickets
  SET status = 'serving', served_at = now()
  WHERE queue_tickets.id = v_next_id
  RETURNING queue_tickets.id, queue_tickets.code, queue_tickets.customer_name;
END;
$$;

REVOKE ALL ON FUNCTION public.skip_ticket(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.skip_ticket(uuid) TO authenticated, service_role;
