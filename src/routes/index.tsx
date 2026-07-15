import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Zap, AlertTriangle, Receipt, ShieldCheck, Monitor } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

const categories = [
  {
    tipe: "pasang_baru",
    label: "Pasang Baru",
    desc: "Pemasangan sambungan listrik baru",
    Icon: Zap,
    prefix: "A",
  },
  {
    tipe: "gangguan",
    label: "Gangguan",
    desc: "Laporan gangguan aliran listrik",
    Icon: AlertTriangle,
    prefix: "B",
  },
  {
    tipe: "tagihan",
    label: "Tagihan",
    desc: "Layanan tagihan & pembayaran",
    Icon: Receipt,
    prefix: "C",
  },
] as const;

function Index() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-accent/30">
      <header className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-5xl px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-secondary text-secondary-foreground grid place-items-center font-black">
              PLN
            </div>
            <div>
              <h1 className="text-lg font-bold leading-tight">Antrean Pelanggan</h1>
              <p className="text-xs opacity-80">Layanan Cepat & Terjadwal</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/tampilan"
              className="text-xs inline-flex items-center gap-1 rounded-md bg-primary-foreground/10 px-3 py-2 hover:bg-primary-foreground/20"
            >
              <Monitor className="h-4 w-4" /> Papan Antrean
            </Link>
            <Link
              to="/auth"
              className="text-xs inline-flex items-center gap-1 rounded-md bg-primary-foreground/10 px-3 py-2 hover:bg-primary-foreground/20"
            >
              <ShieldCheck className="h-4 w-4" /> Login Petugas
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="text-center max-w-xl mx-auto mb-10">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Pilih Layanan Anda</h2>
          <p className="mt-3 text-muted-foreground">
            Ambil nomor antrean sesuai kebutuhan. Tunggu panggilan tanpa harus mengantre di loket.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {categories.map(({ tipe, label, desc, Icon, prefix }) => (
            <Link
              key={tipe}
              to="/ambil"
              search={{ tipe }}
              className="group rounded-2xl border bg-card p-6 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="h-12 w-12 rounded-xl bg-secondary text-secondary-foreground grid place-items-center">
                  <Icon className="h-6 w-6" />
                </div>
                <span className="text-xs font-mono font-bold text-primary bg-primary/10 px-2 py-1 rounded">
                  {prefix}-XX
                </span>
              </div>
              <h3 className="text-lg font-bold">{label}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
              <p className="mt-4 text-sm font-semibold text-primary group-hover:underline">
                Ambil Nomor →
              </p>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
