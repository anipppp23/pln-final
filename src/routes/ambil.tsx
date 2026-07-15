import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createTicket } from "@/lib/queue.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";

const TipeSchema = z.enum(["pasang_baru", "gangguan", "tagihan"]).optional();
type Tipe = "pasang_baru" | "gangguan" | "tagihan";

export const Route = createFileRoute("/ambil")({
  validateSearch: (s: Record<string, unknown>) => ({
    tipe: TipeSchema.parse(s.tipe),
  }),
  component: AmbilPage,
});

const LABELS = {
  pasang_baru: { label: "Pasang Baru", prefix: "A" },
  gangguan: { label: "Gangguan", prefix: "B" },
  tagihan: { label: "Tagihan", prefix: "C" },
} as const;

function AmbilPage() {
  const { tipe } = Route.useSearch();
  const navigate = useNavigate();
  const create = useServerFn(createTicket);
  const [name, setName] = useState("");
  const [meter, setMeter] = useState("");
  const [loading, setLoading] = useState(false);

  if (!tipe) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="text-center max-w-sm">
          <p className="text-muted-foreground mb-4">Pilih kategori layanan terlebih dahulu.</p>
          <Link to="/" className="text-primary font-semibold underline">Kembali ke Beranda</Link>
        </div>
      </div>
    );
  }

  const meta = LABELS[tipe as Tipe];

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tipe) return;
    setLoading(true);
    try {
      const ticket = await create({
        data: { category: tipe, customer_name: name.trim(), meter_number: meter.trim() },
      });
      toast.success(`Nomor antrean Anda: ${ticket.code}`);
      navigate({ to: "/tiket/$id", params: { id: ticket.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat antrean");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-accent/30">
      <header className="bg-primary text-primary-foreground px-4 py-4">
        <div className="mx-auto max-w-md flex items-center gap-3">
          <Link to="/" className="p-1 rounded hover:bg-primary-foreground/10">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs opacity-80">Ambil Antrean</p>
            <h1 className="font-bold">{meta.label}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md p-4">
        <div className="rounded-2xl bg-card border shadow-sm p-6">
          <div className="mb-6 text-center">
            <div className="mx-auto h-14 w-14 rounded-xl bg-secondary text-secondary-foreground grid place-items-center font-black text-lg">
              {meta.prefix}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Isi data Anda untuk mendapatkan nomor antrean.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Nama Pelanggan</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Budi Santoso"
                required
                minLength={2}
                maxLength={100}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meter">Nomor Meteran / ID Pelanggan</Label>
              <Input
                id="meter"
                value={meter}
                onChange={(e) => setMeter(e.target.value)}
                placeholder="Contoh: 123456789012"
                required
                minLength={3}
                maxLength={30}
                inputMode="numeric"
              />
            </div>
            <Button type="submit" className="w-full h-12 text-base" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Ambil Nomor Antrean"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}