import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const CategorySchema = z.enum(["pasang_baru", "gangguan", "tagihan"]);

function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const createTicket = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        category: CategorySchema,
        customer_name: z.string().trim().min(2).max(100),
        meter_number: z.string().trim().min(3).max(30),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const sb = publicClient();
    const { data: row, error } = await sb
      .from("queue_tickets")
      .insert({
        category: data.category,
        customer_name: data.customer_name,
        meter_number: data.meter_number,
        // number & code are assigned by trigger; provide placeholders
        number: 0,
        code: "",
      })
      .select("id, code, category, number, status, ticket_date")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data?.role ?? null;
  });

const roleToCategory = {
  admin_pasang_baru: "pasang_baru",
  admin_gangguan: "gangguan",
  admin_tagihan: "tagihan",
} as const;

export const callNext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roleRow } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .maybeSingle();
    const role = roleRow?.role as keyof typeof roleToCategory | undefined;
    if (!role) throw new Error("Anda belum memiliki peran admin");
    const category = roleToCategory[role];

    // Single atomic RPC: finishes whatever is currently serving and promotes
    // the next waiting ticket in one DB transaction with row locking. This
    // replaces the previous two-round-trip approach, which had a race window
    // where two concurrent calls (double-click, two admin tabs on the same
    // category) could both attempt to promote a ticket at once.
    const { data, error } = await context.supabase.rpc("call_next_ticket", {
      p_category: category,
    });
    if (error) throw new Error(error.message);

    const called = data && data.length > 0 ? data[0] : null;
    return { called };
  });

export const skipTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    // Atomic RPC: skips the ticket, and if it was the one currently being
    // served, promotes the next waiting ticket in the same transaction so
    // the "serving" slot doesn't sit empty until the admin remembers to
    // separately click "call next".
    const { data: result, error } = await context.supabase.rpc("skip_ticket", {
      p_ticket_id: data.id,
    });
    if (error) throw new Error(error.message);

    const called = result && result.length > 0 ? result[0] : null;
    return { ok: true, called };
  });
