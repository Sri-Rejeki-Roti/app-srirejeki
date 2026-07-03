-- ============================================================
-- SETUP DATABASE BARU - SRI REJEKI (master.html + kasir.html + owner.html + payroll)
-- Dibuat otomatis berdasarkan struktur yang dipakai di aplikasi
-- Cara pakai:
--   1. Buka project Supabase BARU -> SQL Editor
--   2. Paste seluruh isi file ini -> klik RUN
--   3. Setelah sukses, paste hasil "Backup SQL" (dari tombol Backup di master.html) -> RUN lagi
--   4. Update SUPABASE_URL & SUPABASE_KEY di semua file HTML ke project baru
-- ============================================================

BEGIN;

-- ============================================================
-- 1. CABANG
-- ============================================================
CREATE TABLE IF NOT EXISTS cabang (
  id          BIGSERIAL PRIMARY KEY,
  nama        TEXT NOT NULL,
  password    TEXT NOT NULL,
  aktif       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. KATEGORI
-- ============================================================
CREATE TABLE IF NOT EXISTS kategori (
  id          BIGSERIAL PRIMARY KEY,
  nama        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. PRODUK
-- ============================================================
CREATE TABLE IF NOT EXISTS produk (
  id           BIGSERIAL PRIMARY KEY,
  nama         TEXT NOT NULL,
  harga        NUMERIC NOT NULL DEFAULT 0,
  hpp          NUMERIC NOT NULL DEFAULT 0,
  kategori_id  BIGINT REFERENCES kategori(id) ON DELETE SET NULL,
  aktif        BOOLEAN NOT NULL DEFAULT TRUE,
  emoji        TEXT,
  foto         TEXT,              -- base64 image, boleh NULL
  satuan       TEXT,              -- kolom lama, dipertahankan untuk kompatibilitas
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_produk_kategori ON produk(kategori_id);

-- ============================================================
-- 4. STOK_CABANG (stok per produk per cabang)
-- ============================================================
CREATE TABLE IF NOT EXISTS stok_cabang (
  id          BIGSERIAL PRIMARY KEY,
  produk_id   BIGINT NOT NULL REFERENCES produk(id) ON DELETE CASCADE,
  cabang_id   BIGINT NOT NULL REFERENCES cabang(id) ON DELETE CASCADE,
  stok        NUMERIC NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (produk_id, cabang_id)
);
CREATE INDEX IF NOT EXISTS idx_stokcabang_produk ON stok_cabang(produk_id);
CREATE INDEX IF NOT EXISTS idx_stokcabang_cabang ON stok_cabang(cabang_id);

-- ============================================================
-- 5. STOK_LOG (riwayat perubahan stok manual)
-- ============================================================
CREATE TABLE IF NOT EXISTS stok_log (
  id          BIGSERIAL PRIMARY KEY,
  produk_id   BIGINT REFERENCES produk(id) ON DELETE SET NULL,
  cabang_id   BIGINT REFERENCES cabang(id) ON DELETE SET NULL,
  stok_lama   NUMERIC,
  stok_baru   NUMERIC,
  alasan      TEXT,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stoklog_created ON stok_log(created_at);

-- ============================================================
-- 6. PELANGGAN
-- ============================================================
CREATE TABLE IF NOT EXISTS pelanggan (
  id            BIGSERIAL PRIMARY KEY,
  nama          TEXT NOT NULL,
  no_hp         TEXT,
  alamat        TEXT,
  diskon_tipe   TEXT NOT NULL DEFAULT 'persen',   -- 'persen' | 'nominal'
  diskon_nilai  NUMERIC NOT NULL DEFAULT 0,
  cabang_id     BIGINT REFERENCES cabang(id) ON DELETE SET NULL,
  total_kredit  NUMERIC NOT NULL DEFAULT 0,
  aktif         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pelanggan_cabang ON pelanggan(cabang_id);

-- ============================================================
-- 7. RETUR
-- ============================================================
CREATE TABLE IF NOT EXISTS retur (
  id          BIGSERIAL PRIMARY KEY,
  produk_id   BIGINT REFERENCES produk(id) ON DELETE SET NULL,
  cabang_id   BIGINT REFERENCES cabang(id) ON DELETE SET NULL,
  qty         NUMERIC NOT NULL,
  alasan      TEXT,
  catatan     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_retur_created ON retur(created_at);

-- ============================================================
-- 8. RESTOK
-- ============================================================
CREATE TABLE IF NOT EXISTS restok (
  id           BIGSERIAL PRIMARY KEY,
  produk_id    BIGINT REFERENCES produk(id) ON DELETE SET NULL,
  cabang_id    BIGINT REFERENCES cabang(id) ON DELETE SET NULL,
  qty          NUMERIC NOT NULL,
  keterangan   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_restok_created ON restok(created_at);

-- ============================================================
-- 9. BAHAN_BAKU
-- ============================================================
CREATE TABLE IF NOT EXISTS bahan_baku (
  id             BIGSERIAL PRIMARY KEY,
  nama           TEXT NOT NULL,
  unit           TEXT,
  stok           NUMERIC NOT NULL DEFAULT 0,
  stok_minimum   NUMERIC NOT NULL DEFAULT 0,
  harga_satuan   NUMERIC NOT NULL DEFAULT 0,
  aktif          BOOLEAN NOT NULL DEFAULT TRUE,
  emoji          TEXT DEFAULT '🧂',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 10. BAGIAN (divisi/departemen pegawai)
-- ============================================================
CREATE TABLE IF NOT EXISTS bagian (
  id          BIGSERIAL PRIMARY KEY,
  nama        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 11. PEGAWAI
-- ============================================================
CREATE TABLE IF NOT EXISTS pegawai (
  id           BIGSERIAL PRIMARY KEY,
  nama         TEXT NOT NULL,
  bagian       TEXT,
  jabatan      TEXT,
  aktif        BOOLEAN NOT NULL DEFAULT TRUE,
  gaji_pokok   NUMERIC NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 12. PENGAMBILAN_BAHAN
-- ============================================================
CREATE TABLE IF NOT EXISTS pengambilan_bahan (
  id          BIGSERIAL PRIMARY KEY,
  bahan_id    BIGINT REFERENCES bahan_baku(id) ON DELETE SET NULL,
  pegawai_id  BIGINT REFERENCES pegawai(id) ON DELETE SET NULL,
  jumlah      NUMERIC NOT NULL,
  catatan     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pengambilan_created ON pengambilan_bahan(created_at);

-- ============================================================
-- 13. TRANSAKSI (header transaksi kasir)
-- ============================================================
CREATE TABLE IF NOT EXISTS transaksi (
  id            BIGSERIAL PRIMARY KEY,
  nomor         TEXT,
  tipe          TEXT,                 -- misal: 'jual', 'kredit', dst
  pelanggan_id  BIGINT REFERENCES pelanggan(id) ON DELETE SET NULL,
  cabang_id     BIGINT REFERENCES cabang(id) ON DELETE SET NULL,
  total         NUMERIC NOT NULL DEFAULT 0,
  metode_bayar  TEXT,
  bayar         NUMERIC DEFAULT 0,
  kembalian     NUMERIC DEFAULT 0,
  catatan       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transaksi_cabang ON transaksi(cabang_id);
CREATE INDEX IF NOT EXISTS idx_transaksi_pelanggan ON transaksi(pelanggan_id);
CREATE INDEX IF NOT EXISTS idx_transaksi_created ON transaksi(created_at);

-- ============================================================
-- 14. TRANSAKSI_ITEM (detail per produk dalam 1 transaksi)
-- ============================================================
CREATE TABLE IF NOT EXISTS transaksi_item (
  id             BIGSERIAL PRIMARY KEY,
  transaksi_id   BIGINT NOT NULL REFERENCES transaksi(id) ON DELETE CASCADE,
  produk_id      BIGINT REFERENCES produk(id) ON DELETE SET NULL,
  qty            NUMERIC NOT NULL DEFAULT 0,
  harga          NUMERIC NOT NULL DEFAULT 0,
  subtotal       NUMERIC NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_trxitem_transaksi ON transaksi_item(transaksi_id);
CREATE INDEX IF NOT EXISTS idx_trxitem_produk ON transaksi_item(produk_id);

-- ============================================================
-- 15. SETTINGS (key-value, misal master_password)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
  id          BIGSERIAL PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  value       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 16. PAYROLL_SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll_settings (
  id          BIGSERIAL PRIMARY KEY,
  tipe        TEXT,
  nilai       NUMERIC DEFAULT 0,
  keterangan  TEXT,
  aktif       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 17. ABSENSI (dipakai Payroll Radja)
-- ============================================================
CREATE TABLE IF NOT EXISTS absensi (
  id           BIGSERIAL PRIMARY KEY,
  pegawai_id   BIGINT REFERENCES pegawai(id) ON DELETE SET NULL,
  tanggal      DATE,
  jam_masuk    TIMESTAMPTZ,
  jam_keluar   TIMESTAMPTZ,
  status       TEXT,
  keterangan   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_absensi_pegawai ON absensi(pegawai_id);
CREATE INDEX IF NOT EXISTS idx_absensi_tanggal ON absensi(tanggal);

-- ============================================================
-- 18. LEMBUR (dipakai Payroll Radja)
-- ============================================================
CREATE TABLE IF NOT EXISTS lembur (
  id           BIGSERIAL PRIMARY KEY,
  pegawai_id   BIGINT REFERENCES pegawai(id) ON DELETE SET NULL,
  tanggal      DATE,
  jam          NUMERIC DEFAULT 0,
  keterangan   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lembur_pegawai ON lembur(pegawai_id);

-- ============================================================
-- 19. PUSH_SUBSCRIPTIONS (notifikasi PWA)
-- ============================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            BIGSERIAL PRIMARY KEY,
  endpoint      TEXT NOT NULL UNIQUE,
  subscription  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMIT;

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- Aplikasi ini TIDAK memakai Supabase Auth (login dicek manual
-- lewat tabel settings/password di JS, pakai anon key langsung).
-- Supaya app tetap bisa baca/tulis seperti sebelumnya, RLS
-- diaktifkan tapi policy dibuka penuh untuk role anon & authenticated.
-- ⚠️ Ini BUKAN keamanan tingkat lanjut — siapapun yang punya anon key
-- (terlihat di source HTML) tetap bisa akses data. Kalau butuh
-- proteksi lebih ketat, perlu migrasi ke Supabase Auth + policy per-user.
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'cabang','kategori','produk','stok_cabang','stok_log','pelanggan',
      'retur','restok','bahan_baku','bagian','pegawai','pengambilan_bahan',
      'transaksi','transaksi_item','settings','payroll_settings',
      'absensi','lembur','push_subscriptions'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS "allow_all_select_%1$s" ON %1$I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_insert_%1$s" ON %1$I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_update_%1$s" ON %1$I;', t);
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_delete_%1$s" ON %1$I;', t);

    EXECUTE format('CREATE POLICY "allow_all_select_%1$s" ON %1$I FOR SELECT TO anon, authenticated USING (true);', t);
    EXECUTE format('CREATE POLICY "allow_all_insert_%1$s" ON %1$I FOR INSERT TO anon, authenticated WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "allow_all_update_%1$s" ON %1$I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "allow_all_delete_%1$s" ON %1$I FOR DELETE TO anon, authenticated USING (true);', t);
  END LOOP;
END $$;

-- ============================================================
-- REALTIME (opsional tapi dipakai di kasir.html/master.html untuk
-- subscribe perubahan stok_cabang secara live)
-- ============================================================
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE stok_cabang;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE produk;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ============================================================
-- SELESAI. Langkah selanjutnya:
-- 1. Jalankan file backup SQL (hasil generate dari tombol Backup
--    di master.html) untuk mengisi data master.
-- 2. Cek urutan insert aman karena backup pakai ON CONFLICT DO NOTHING
--    dan tabel referensi (cabang, kategori, dst) sudah ada duluan.
-- 3. Update SUPABASE_URL & SUPABASE_KEY (anon key) di semua HTML app
--    (master.html, kasir.html, owner.html, dan app payroll) ke project baru.
-- ============================================================
