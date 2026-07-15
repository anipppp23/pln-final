
-- role_for_category is a plain immutable helper; not security definer needed
CREATE OR REPLACE FUNCTION public.role_for_category(_cat public.queue_category)
RETURNS public.admin_role
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT CASE _cat
    WHEN 'pasang_baru' THEN 'admin_pasang_baru'::public.admin_role
    WHEN 'gangguan' THEN 'admin_gangguan'::public.admin_role
    WHEN 'tagihan' THEN 'admin_tagihan'::public.admin_role
  END
$$;

-- Lock down function execution
REVOKE ALL ON FUNCTION public.role_for_category(public.queue_category) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.role_for_category(public.queue_category) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.admin_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.admin_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.assign_ticket_number() FROM PUBLIC, anon, authenticated;
-- trigger function only needs to run as trigger owner; no direct grants required

-- Tighten INSERT policy: only allow inserting waiting tickets with basic validation
DROP POLICY "Public can create tickets" ON public.queue_tickets;
CREATE POLICY "Public can create waiting tickets"
  ON public.queue_tickets FOR INSERT
  WITH CHECK (
    status = 'waiting'
    AND length(trim(customer_name)) BETWEEN 2 AND 100
    AND length(trim(meter_number)) BETWEEN 3 AND 30
  );
