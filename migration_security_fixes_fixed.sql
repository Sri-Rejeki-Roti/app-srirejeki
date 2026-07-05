-- ============================================================
-- MIGRATION: PERBAIKAN KEAMANAN - SRI REJEKI
-- Aman dijalankan di database yang SUDAH JALAN (idempotent).
-- Jalankan sekali di SQL Editor Supabase project yang sedang dipakai.
--
-- Isi migration ini:
--   1. RPC decrement_stok_cabang (atomic, dipakai kasir.html)
--   2. RPC hapus_kategori (dipakai master.html)
--   3. Password settings (master/owner/payroll) dipindah dari plaintext
--      ke hash bcrypt + RPC verifikasi (pgcrypto), jadi tidak lagi bisa
--      dibaca langsung lewat REST API (anon key) walau tanpa login.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. RPC: decrement_stok_cabang
--    Kontrak parameter HARUS persis sama dengan yang dipanggil
--    di kasir.html: p_produk_id, p_cabang_id, p_qty
--    Atomic single UPDATE -> aman dari race condition 2 kasir
--    jual produk yang sama bersamaan (tidak seperti fallback
--    read-then-write di client).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION decrement_stok_cabang(
  p_produk_id BIGINT,
  p_cabang_id BIGINT,
  p_qty       NUMERIC
)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE stok_cabang
  SET stok = GREATEST(0, stok - p_qty)
  WHERE produk_id = p_produk_id AND cabang_id = p_cabang_id;
$$;

GRANT EXECUTE ON FUNCTION decrement_stok_cabang(BIGINT, BIGINT, NUMERIC) TO anon, authenticated;

-- ------------------------------------------------------------
-- 2. RPC: hapus_kategori
--    Kontrak parameter: kat_id (sesuai panggilan di master.html)
--    Lepas kategori dari produk lalu hapus kategori, dalam satu
--    transaksi function (kalau salah satu gagal, semua batal).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION hapus_kategori(kat_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE produk SET kategori_id = NULL WHERE kategori_id = kat_id;
  DELETE FROM kategori WHERE id = kat_id;
END;
$$;

GRANT EXECUTE ON FUNCTION hapus_kategori(BIGINT) TO anon, authenticated;

-- ------------------------------------------------------------
-- 3. PASSWORD: pindah ke hash + RPC verifikasi
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3a. Migrasi nilai password yang SUDAH ADA (plaintext) jadi hash.
--     Kondisi "NOT LIKE '$2%'" mencegah hash ganda kalau migration
--     ini ditjalankan lebih dari sekali (bcrypt hash selalu diawali $2a$/$2b$/$2y$).
UPDATE settings
SET value = crypt(value, gen_salt('bf'))
WHERE key IN ('master_password', 'owner_password', 'payroll_password')
  AND value IS NOT NULL
  AND value NOT LIKE '$2%';

-- 3b. RPC: cek apakah password untuk key tertentu sudah pernah diatur.
--     Dipakai untuk mode "atur password pertama kali" tanpa perlu
--     SELECT langsung ke tabel settings.
CREATE OR REPLACE FUNCTION setting_password_exists(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM settings
    WHERE key = p_key AND p_key LIKE '%\_password' ESCAPE '\'
  );
$$;

-- 3c. RPC: verifikasi password. Return NULL kalau belum pernah diatur
--     (beda dengan FALSE = salah), TRUE/FALSE kalau sudah ada.
CREATE OR REPLACE FUNCTION verify_setting_password(p_key TEXT, p_input TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  IF p_key NOT LIKE '%\_password' ESCAPE '\' THEN
    RAISE EXCEPTION 'invalid key';
  END IF;
  SELECT value INTO v_hash FROM settings WHERE key = p_key;
  IF v_hash IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_hash = crypt(p_input, v_hash);
END;
$$;

-- 3d. RPC: ganti/buat password.
--     - Kalau belum ada row -> langsung buat (skip cek password lama),
--       sama seperti perilaku lama di client.
--     - Kalau sudah ada -> cek p_old dulu, baru update.
--     Return TRUE kalau berhasil, FALSE kalau password lama salah.
CREATE OR REPLACE FUNCTION set_setting_password(p_key TEXT, p_old TEXT, p_new TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash TEXT;
BEGIN
  IF p_key NOT LIKE '%\_password' ESCAPE '\' THEN
    RAISE EXCEPTION 'invalid key';
  END IF;
  IF p_new IS NULL OR length(p_new) = 0 THEN
    RAISE EXCEPTION 'new password required';
  END IF;

  SELECT value INTO v_hash FROM settings WHERE key = p_key;

  IF v_hash IS NULL THEN
    INSERT INTO settings (key, value) VALUES (p_key, crypt(p_new, gen_salt('bf')));
    RETURN TRUE;
  END IF;

  IF v_hash <> crypt(p_old, v_hash) THEN
    RETURN FALSE;
  END IF;

  UPDATE settings SET value = crypt(p_new, gen_salt('bf')) WHERE key = p_key;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION setting_password_exists(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_setting_password(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_setting_password(TEXT, TEXT, TEXT) TO anon, authenticated;

-- 3e. Cabut akses SELECT langsung ke baris password. Key lain di
--     tabel settings (kalau ada) tetap bisa dibaca seperti biasa.
--     Password sekarang HANYA bisa diverifikasi lewat RPC di atas
--     (yang jalan sebagai SECURITY DEFINER, bypass RLS ini).
--     Drop kedua kemungkinan nama policy lama (beda-beda tergantung
--     versi setup_database yang dipakai) supaya CREATE POLICY di
--     bawah tidak pernah tabrakan / gagal karena "already exists".
DROP POLICY IF EXISTS "allow_all_select_settings" ON settings;
DROP POLICY IF EXISTS "select_settings_except_password" ON settings;
CREATE POLICY "select_settings_except_password" ON settings
  FOR SELECT TO anon, authenticated
  USING (key NOT IN ('master_password', 'owner_password', 'payroll_password'));

-- INSERT/UPDATE langsung ke key password lewat client tidak lagi dipakai
-- (semua lewat RPC), tapi kalau mau lebih ketat lagi, policy INSERT/UPDATE
-- untuk settings juga bisa dibatasi serupa. Dibiarkan longgar dulu supaya
-- tidak mematahkan fitur settings lain yang mungkin masih pakai insert/update biasa.

COMMIT;

-- ============================================================
-- SELESAI. Setelah migration ini jalan, WAJIB update kode client:
-- master.html, owner.html, payroll.html — ganti semua
-- sb.from('settings').select(...) / insert(...) / update(...)
-- untuk key *_password menjadi panggilan RPC:
--   - setting_password_exists(p_key)
--   - verify_setting_password(p_key, p_input)
--   - set_setting_password(p_key, p_old, p_new)
-- (Sudah dikerjakan di file .html yang dikirim bersama migration ini.)
-- ============================================================
