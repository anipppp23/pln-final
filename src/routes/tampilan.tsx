import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Zap, AlertTriangle, Receipt } from "lucide-react";

export const Route = createFileRoute("/tampilan")({
  component: DisplayBoard,
});

type Category = "pasang_baru" | "gangguan" | "tagihan";

type Ticket = {
  id: string;
  code: string;
  number: number;
  customer_name: string;
  status: "waiting" | "serving" | "done" | "skipped";
  category: Category;
  ticket_date: string;
};

const CATEGORY_META: Record<Category, { label: string; Icon: typeof Zap; accent: string }> = {
  pasang_baru: { label: "Pasang Baru", Icon: Zap, accent: "border-blue-500 bg-blue-50" },
  gangguan: { label: "Gangguan", Icon: AlertTriangle, accent: "border-amber-500 bg-amber-50" },
  tagihan: { label: "Tagihan", Icon: Receipt, accent: "border-emerald-500 bg-emerald-50" },
};

const CATEGORIES: Category[] = ["pasang_baru", "gangguan", "tagihan"];

// This route is meant to be opened full-screen on a TV/monitor mounted in
// the waiting room. It intentionally requires no login and no ticket ID —
// unlike /tiket/$id (which needs a specific ticket to check status against),
// this shows the current "now serving" + upcoming numbers for all three
// categories at once, which is what a physical office display needs.
function DisplayBoard() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const clockTimer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(clockTimer);
  }, []);

  useEffect(() => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });

    async function load() {
      const { data } = await supabase
        .from("queue_tickets")
        .select("id, code, number, customer_name, status, category, ticket_date")
        .eq("ticket_date", today)
        .in("status", ["waiting", "serving"])
        .order("number", { ascending: true });
      setTickets((data as Ticket[] | null) ?? []);
    }

    load();

    const channel = supabase
      .channel("display-board")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue_tickets" }, () =>
        load(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-8 flex flex-col">
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-xl bg-yellow-400 text-slate-900 grid place-items-center font-black text-xl">
            PLN
          </div>
          <div>
            <h1 className="text-2xl font-bold">Papan Antrean</h1>
            <p className="text-slate-400 text-sm">Layanan Pelanggan</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-3xl font-mono font-bold tabular-nums">
            {now.toLocaleTimeString("id-ID", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </p>
          <p className="text-slate-400 text-sm">
            {now.toLocaleDateString("id-ID", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: "Asia/Jakarta",
            })}
          </p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-6 flex-1">
        {CATEGORIES.map((cat) => {
          const meta = CATEGORY_META[cat];
          const catTickets = tickets.filter((t) => t.category === cat);
          const serving = catTickets.find((t) => t.status === "serving");
          const waiting = catTickets.filter((t) => t.status === "waiting");
          const upNext = waiting.slice(0, 5);

          return (
            <section
              key={cat}
              className="rounded-2xl bg-slate-800 border border-slate-700 flex flex-col overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-slate-700 flex items-center gap-3">
                <meta.Icon className="h-6 w-6 text-slate-300" />
                <h2 className="font-bold text-lg">{meta.label}</h2>
              </div>

              <div className="px-6 py-8 text-center border-b border-slate-700">
                <p className="text-xs uppercase tracking-widest text-slate-400 mb-2">
                  Sedang Dilayani
                </p>
                <p className="font-mono text-7xl font-black tabular-nums">
                  {serving ? serving.code : "—"}
                </p>
                {serving && (
                  <p className="mt-2 text-slate-300 text-sm truncate">{serving.customer_name}</p>
                )}
              </div>

              <div className="px-6 py-4 flex-1">
                <p className="text-xs uppercase tracking-widest text-slate-400 mb-3">
                  Antrean Berikutnya ({waiting.length})
                </p>
                {upNext.length === 0 ? (
                  <p className="text-slate-500 text-sm">Tidak ada antrean menunggu</p>
                ) : (
                  <ul className="space-y-2">
                    {upNext.map((t) => (
                      <li key={t.id} className="font-mono text-2xl font-bold text-slate-200">
                        {t.code}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
