import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

export const Route = createFileRoute("/tiket/$id")({
  component: TicketPage,
});

type Ticket = {
  id: string;
  code: string;
  category: "pasang_baru" | "gangguan" | "tagihan";
  number: number;
  status: "waiting" | "serving" | "done" | "skipped";
  customer_name: string;
  ticket_date: string;
};

const CATEGORY_LABEL = {
  pasang_baru: "Pasang Baru",
  gangguan: "Gangguan",
  tagihan: "Tagihan",
} as const;

function TicketPage() {
  const { id } = Route.useParams();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [serving, setServing] = useState<Ticket | null>(null);
  const [ahead, setAhead] = useState<number>(0);
  const [qrUrl, setQrUrl] = useState<string>("");

  useEffect(() => {
    // Only access window on the client side
    setQrUrl(window.location.origin + `/tiket/${id}`);
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    async function loadAll(t?: Ticket | null) {
      const current = t ?? ticket;
      if (!current) return;
      const [{ data: srv }, { count }] = await Promise.all([
        supabase
          .from("queue_tickets")
          .select("id, code, category, number, status, customer_name, ticket_date")
          .eq("category", current.category)
          .eq("ticket_date", current.ticket_date)
          .eq("status", "serving")
          .maybeSingle(),
        supabase
          .from("queue_tickets")
          .select("id", { count: "exact", head: true })
          .eq("category", current.category)
          .eq("ticket_date", current.ticket_date)
          .eq("status", "waiting")
          .lt("number", current.number),
      ]);
      if (cancelled) return;
      setServing((srv as Ticket | null) ?? null);
      setAhead(count ?? 0);
    }

    async function loadTicket() {
      const { data } = await supabase
        .from("queue_tickets")
        .select("id, code, category, number, status, customer_name, ticket_date")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      const t = data as Ticket | null;
      setTicket(t);
      if (t) loadAll(t);
    }

    loadTicket();

    const channel = supabase
      .channel(`ticket-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue_tickets" },
        () => {
          loadTicket();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [id]);

  if (!ticket) {
    return (
      <div className="min-h-screen grid place-items-center">
        <p className="text-muted-foreground">Memuat tiket...</p>
      </div>
    );
  }

  const isMe = serving?.id === ticket.id;
  const isDone = ticket.status === "done" || ticket.status === "skipped";

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-accent/30">
      <header className="bg-primary text-primary-foreground px-4 py-4">
        <div className="mx-auto max-w-md flex items-center gap-3">
          <Link to="/" className="p-1 rounded hover:bg-primary-foreground/10">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs opacity-80">Tiket Antrean</p>
            <h1 className="font-bold">{CATEGORY_LABEL[ticket.category]}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md p-4 space-y-4">
        <div
          className={`rounded-2xl p-8 text-center border shadow-sm transition ${
            isMe
              ? "bg-secondary text-secondary-foreground animate-pulse"
              : "bg-card"
          }`}
        >
          <p className="text-sm opacity-80">Nomor Antrean Anda</p>
          <p className="mt-2 font-mono text-7xl font-black tracking-tight">
            {ticket.code}
          </p>
          <p className="mt-2 text-sm">a.n. {ticket.customer_name}</p>
          
          {qrUrl && (
            <div className="mt-6 flex justify-center">
              <div className="bg-white p-3 rounded-lg shadow-inner">
                <QRCodeSVG
                  value={qrUrl}
                  size={140}
                  level={"H"}
                  includeMargin={false}
                />
              </div>
            </div>
          )}

          {isMe && (
            <p className="mt-4 text-lg font-bold">🔔 Silakan menuju loket!</p>
          )}
          {isDone && (
            <p className="mt-4 text-sm font-semibold">
              Antrean {ticket.status === "done" ? "selesai" : "dilewati"}.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-card border p-4 text-center">
            <p className="text-xs text-muted-foreground">Sedang Dilayani</p>
            <p className="mt-1 font-mono text-2xl font-bold text-primary">
              {serving ? serving.code : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-card border p-4 text-center">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
              <Users className="h-3 w-3" /> Di depan Anda
            </p>
            <p className="mt-1 text-2xl font-bold">
              {isMe || isDone ? 0 : ahead}
            </p>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Halaman ini otomatis diperbarui. Mohon menunggu panggilan.
        </p>
      </main>
    </div>
  );
}