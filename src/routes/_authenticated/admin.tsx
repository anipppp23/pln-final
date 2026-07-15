import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { callNext, getMyRole, skipTicket } from "@/lib/queue.functions";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bell, LogOut, PhoneCall, SkipForward, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
});

type Ticket = {
  id: string;
  code: string;
  number: number;
  customer_name: string;
  meter_number: string;
  status: "waiting" | "serving" | "done" | "skipped";
  category: "pasang_baru" | "gangguan" | "tagihan";
  ticket_date: string;
  created_at: string;
};

const ROLE_META = {
  admin_pasang_baru: { category: "pasang_baru", label: "Pasang Baru", prefix: "A" },
  admin_gangguan: { category: "gangguan", label: "Gangguan", prefix: "B" },
  admin_tagihan: { category: "tagihan", label: "Tagihan", prefix: "C" },
} as const;

// short bell chime (base64 wav)
const CHIME_SRC =
  "data:audio/wav;base64,UklGRiQFAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQAFAACAgICAgICAgICAgICAgICAgICAgICAgIB/f39/f39/f39/f39/gICAgICAgICAgICAgICAf39/f39/f39/f39/f4CAgICAgICAgICAgICAgH9/f39/f39/f39/f4CAgICAgICAgICAgICAgH9/f39/f39/f39/gICAgICAgICAgICAgICAf39/f39/f39/f4CAgICAgICAgICAgICAgH9/f39/f39/f4CAgICAgICAgICAgICAgH9/f39/f39/gICAgICAgICAgICAgICAf39/f39/f4CAgICAgICAgICAgICAgH9/f39/f4CAgICAgICAgICAgICAgH9/f39/gICAgICAgICAgICAgICAf39/f4CAgICAgICAgICAgICAgH9/f4CAgICAgICAgICAgICAgH9/gICAgICAgICAgICAgICAf4CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA";

function AdminPage() {
  const navigate = useNavigate();
  const fetchRole = useServerFn(getMyRole);
  const doCallNext = useServerFn(callNext);
  const doSkip = useServerFn(skipTicket);

  const [role, setRole] = useState<keyof typeof ROLE_META | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const initializedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  useEffect(() => {
    fetchRole()
      .then((r) => setRole(r as keyof typeof ROLE_META | null))
      .catch(() => setRole(null))
      .finally(() => setRoleLoading(false));
  }, [fetchRole]);

  const loadTickets = useCallback(async (category: "pasang_baru" | "gangguan" | "tagihan") => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
    const { data } = await supabase
      .from("queue_tickets")
      .select("*")
      .eq("category", category)
      .eq("ticket_date", today)
      .in("status", ["waiting", "serving"])
      .order("number", { ascending: true });
    const rows = (data as Ticket[] | null) ?? [];
    if (!initializedRef.current) {
      rows.forEach((t) => seenIdsRef.current.add(t.id));
      initializedRef.current = true;
    }
    setTickets(rows);
  }, []);

  useEffect(() => {
    if (!role) return;
    const meta = ROLE_META[role];
    loadTickets(meta.category);

    const channel = supabase
      .channel(`admin-${meta.category}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "queue_tickets",
          filter: `category=eq.${meta.category}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as Ticket;
            if (!seenIdsRef.current.has(row.id)) {
              seenIdsRef.current.add(row.id);
              audioRef.current?.play().catch(() => {});
              toast.info(`Antrean baru: ${row.code} — ${row.customer_name}`);
            }
          }
          loadTickets(meta.category);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [role, loadTickets]);

  async function handleCallNext() {
    setBusy(true);
    try {
      const res = await doCallNext();
      if (!res.called) toast.info("Tidak ada antrean menunggu");
      else toast.success(`Memanggil ${res.called.code}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal memanggil");
    } finally {
      setBusy(false);
    }
  }

  async function handleSkip(id: string) {
    setBusy(true);
    try {
      const res = await doSkip({ data: { id } });
      if (res.called) {
        toast.success(`Antrean dilewati. Memanggil ${res.called.code} berikutnya`);
      } else {
        toast.success("Antrean dilewati");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (roleLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!role) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="max-w-md text-center bg-card border rounded-2xl p-8">
          <h2 className="text-xl font-bold">Peran belum ditetapkan</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Akun Anda ({email}) belum memiliki peran admin. Hubungi administrator untuk menetapkan
            salah satu peran: Pasang Baru, Gangguan, atau Tagihan.
          </p>
          <Button className="mt-6" variant="outline" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" /> Keluar
          </Button>
        </div>
      </div>
    );
  }

  const meta = ROLE_META[role];
  const serving = tickets.find((t) => t.status === "serving");
  const waiting = tickets.filter((t) => t.status === "waiting");

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-accent/20">
      <audio ref={audioRef} src={CHIME_SRC} preload="auto" />
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-secondary text-secondary-foreground grid place-items-center font-black">
              PLN
            </div>
            <div>
              <p className="text-xs opacity-80">Dashboard Admin</p>
              <h1 className="font-bold text-lg">Loket {meta.label}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm hidden sm:inline opacity-90">{email}</span>
            <Button variant="secondary" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-1.5" /> Keluar
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8 grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-1 space-y-4">
          <div className="rounded-2xl bg-card border shadow-sm p-6 text-center">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Sedang Dilayani</p>
            <p className="mt-3 font-mono text-6xl font-black text-primary">
              {serving ? serving.code : "—"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground min-h-[1.25rem]">
              {serving ? serving.customer_name : "Belum ada"}
            </p>
            <Button onClick={handleCallNext} disabled={busy} className="mt-6 w-full h-12 text-base">
              <PhoneCall className="h-4 w-4 mr-2" /> Panggil Nomor Selanjutnya
            </Button>
            {serving && (
              <Button
                variant="outline"
                onClick={() => handleSkip(serving.id)}
                disabled={busy}
                className="mt-2 w-full"
              >
                <SkipForward className="h-4 w-4 mr-2" /> Lewati Antrean Ini
              </Button>
            )}
          </div>

          <div className="rounded-xl bg-card border p-4 text-center">
            <p className="text-xs text-muted-foreground">Total Menunggu</p>
            <p className="mt-1 text-3xl font-bold">{waiting.length}</p>
          </div>
        </section>

        <section className="lg:col-span-2">
          <div className="rounded-2xl bg-card border shadow-sm">
            <div className="p-5 border-b flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              <h2 className="font-bold">Antrean Menunggu</h2>
              <span className="ml-auto text-xs text-muted-foreground">Diperbarui real-time</span>
            </div>
            {waiting.length === 0 ? (
              <div className="p-10 text-center text-muted-foreground text-sm">
                Tidak ada antrean menunggu.
              </div>
            ) : (
              <ul className="divide-y">
                {waiting.map((t, i) => (
                  <li key={t.id} className="p-4 flex items-center gap-4">
                    <div className="font-mono text-xl font-bold text-primary w-16">{t.code}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{t.customer_name}</p>
                      <p className="text-xs text-muted-foreground">Meteran: {t.meter_number}</p>
                    </div>
                    {i === 0 && (
                      <span className="text-xs font-medium bg-secondary text-secondary-foreground px-2 py-1 rounded">
                        Berikutnya
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
