# PLN Queue System — Build Plan

A web-based customer queue system for PLN with three service categories (Pasang Baru, Gangguan, Tagihan), real-time sync, and role-based admin dashboards.

## Tech & Backend

- **Lovable Cloud** (Supabase) for database + auth + realtime.
- **Tailwind CSS** with PLN yellow (#FFCB05) + blue (#00A9E0) theme tokens defined in `src/styles.css`.
- **TanStack Start** routes + server functions for privileged writes.
- Realtime updates via Supabase Realtime channels (Postgres changes).

## Database Schema

**`queue_tickets`** table:
- `id` uuid PK
- `category` enum: `pasang_baru` | `gangguan` | `tagihan`
- `number` int (per-category sequence)
- `code` text (e.g. `A-05`, `B-12`, `C-07`) — generated
- `customer_name` text
- `meter_number` text
- `status` enum: `waiting` | `serving` | `done` | `skipped`
- `created_at`, `served_at` timestamps

**`user_roles`** table (separate, per security best practice):
- `user_id` → auth.users
- `role` enum: `admin_pasang_baru` | `admin_gangguan` | `admin_tagihan`
- `has_role()` security-definer function

**RLS policies:**
- Public (anon) INSERT allowed on `queue_tickets` (customers create tickets without login).
- Public SELECT allowed (needed to show "now serving" on customer screen).
- UPDATE only allowed to authenticated users with matching category role.

Code prefix mapping: `pasang_baru → A`, `gangguan → B`, `tagihan → C`.

## Routes

```
/                              → Landing: 3 category cards linking to /ambil?tipe=...
/ambil                         → Customer form (mobile-first), reads ?tipe=
/tiket/$id                     → Customer ticket view with real-time "now serving"
/auth                          → Admin login (email/password)
/_authenticated/admin          → Admin dashboard scoped to the logged-in admin's role
```

### Customer flow (`/ambil?tipe=gangguan`)
- Validates `tipe` param (fallback to selector if missing/invalid).
- Form: nama pelanggan + nomor meteran.
- Submit → server fn `createTicket` (public, rate-limited by category) → returns ticket → navigate to `/tiket/$id`.

### Ticket page (`/tiket/$id`)
- Shows the customer's ticket code big (e.g. `B-12`), name, category.
- Subscribes to realtime changes on `queue_tickets` filtered by category → displays "Antrean saat ini yang dilayani: B-10" and "Antrean di depan Anda: 2".
- Auto highlights + plays a chime when it becomes the served ticket.

### Admin dashboard (`/_authenticated/admin`)
- Reads the logged-in user's role → determines category shown.
- Real-time list of waiting tickets in that category, plus currently serving.
- **"Panggil Nomor Selanjutnya"** button → server fn `callNext` (requires auth + role): marks current serving as `done`, promotes oldest `waiting` to `serving`.
- **Notification when new ticket arrives**: realtime INSERT event triggers (1) bell sound (`<audio>` with an embedded chime), (2) toast pop-up "Antrean baru: B-13 — Budi".
- Buttons: Panggil Selanjutnya, Selesai, Lewati.

## UI & Design

- PLN color tokens in `src/styles.css` (`--pln-yellow`, `--pln-blue`), mapped in `@theme inline`. No hardcoded hex in components.
- Clean, card-based layout. Big rounded ticket numbers, generous spacing.
- Customer pages mobile-first (single column, large tap targets).
- Admin desktop layout: header with role badge + logout, split view (Now Serving hero card + waiting list).
- Font pairing: Poppins-style display for numbers, system sans for body (or a distinctive pairing — will finalize during build).

## Setup Steps

1. Enable Lovable Cloud.
2. Migration: create enums, `queue_tickets`, `user_roles`, `has_role()`, GRANTs, RLS policies, indexes on `(category, status, number)`.
3. Update `src/styles.css` with PLN color tokens.
4. Build routes: `index`, `ambil`, `tiket.$id`, `auth`, `_authenticated/admin`.
5. Server functions: `createTicket` (public), `callNext`, `markDone`, `skipTicket` (role-gated via `requireSupabaseAuth` + `has_role`).
6. Realtime subscription hooks for ticket page + admin page.
7. Notification chime asset + toast on new INSERT.
8. Seed 3 admin users (one per category) via a one-off admin server function OR document manual creation.

## Open Questions

- **Admin accounts**: should I seed 3 demo admin accounts (one per category) with default credentials for you to test, or do you want to create them manually via the auth page + a role-assignment tool?
- **Reset queue daily?** Numbers keep incrementing forever, or reset each day (A-01 every morning)? I'll default to **daily reset** unless you say otherwise.
