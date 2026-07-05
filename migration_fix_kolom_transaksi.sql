-- ============================================================
-- MIGRATION: FIX KOLOM TABEL transaksi & transaksi_item
-- Aman dijalankan berkali-kali (idempotent, pakai IF NOT EXISTS)
-- di database yang SUDAH JALAN. Jalankan sekali di SQL Editor
-- Supabase project yang sedang dipakai.
--
-- Kenapa perlu: kasir.html mengirim field status, kasir,
-- has_override (tabel transaksi) dan nama_produk, stok_override
-- (tabel transaksi_item) yang belum ada di skrip setup awal
-- (setup_database_sri_rejeki.sql), sehingga setiap transaksi
-- gagal insert dan selalu nyangkut di antrian "pending".
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. TRANSAKSI
-- ------------------------------------------------------------
ALTER TABLE transaksi
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS kasir TEXT,
  ADD COLUMN IF NOT EXISTS has_override BOOLEAN NOT NULL DEFAULT FALSE;

-- ------------------------------------------------------------
-- 2. TRANSAKSI_ITEM
-- ------------------------------------------------------------
ALTER TABLE transaksi_item
  ADD COLUMN IF NOT EXISTS nama_produk TEXT,
  ADD COLUMN IF NOT EXISTS stok_override BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;

-- ------------------------------------------------------------
-- 3. Reload schema cache PostgREST supaya kolom baru langsung
--    dikenali API tanpa perlu tunggu cache expire sendiri.
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- SELESAI. Setelah ini:
-- 1. Tunggu ~10-20 detik.
-- 2. Buka kasir.html -> klik badge "pending" -> "Sync Sekarang"
--    untuk mengirim ulang transaksi yang sempat tersangkut.
-- 3. Transaksi baru seharusnya langsung tersimpan online, tanpa
--    jatuh ke antrian offline lagi.
-- ============================================================
