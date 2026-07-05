// supabase/functions/send-stock-alert/index.ts
//
// Edge Function untuk mengirim Web Push notifikasi saat stok produk menipis/habis.
// Dipanggil oleh:
//   1) Trigger database (via pg_net) begitu stok_cabang berkurang — real-time.
//   2) Cron job terjadwal (mis. tiap 30 menit) — jaring pengaman tambahan.
//
// ENV / secrets yang WAJIB di-set di Supabase (Project Settings > Edge Functions > Secrets):
//   VAPID_PUBLIC_KEY   -> harus SAMA PERSIS dengan VAPID_PUBLIC_KEY di config.js (client)
//   VAPID_PRIVATE_KEY  -> pasangan private-nya, JANGAN taruh di file client manapun
//   VAPID_SUBJECT      -> contoh: mailto:admin@srirejeki.com
// SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY sudah otomatis tersedia di runtime Edge Function.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

// ---- Tipe data (menggantikan `any` supaya lolos deno-lint no-explicit-any) ----
interface RequestBody {
  produk_id?: number;
}
interface ProdukRow {
  id: number;
  nama: string;
  stok_minimum: number | string | null;
  aktif: boolean;
}
interface StokCabangRow {
  produk_id: number;
  cabang_id: number;
  stok: number;
}
interface CabangRow {
  id: number;
  nama: string;
}
interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}
interface NotifLogRow {
  level: "menipis" | "habis";
  notified_at: string;
}
// web-push melempar error dengan properti statusCode & body saat push gagal terkirim
interface WebPushError extends Error {
  statusCode?: number;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@srirejeki.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Berapa lama jeda sebelum produk+cabang+level yang sama boleh dinotifikasi lagi,
// supaya tidak spam tiap kali cron/trigger jalan selagi stok masih di bawah ambang.
const JEDA_NOTIF_JAM = 6;

Deno.serve(async (req) => {
  try {
    // Body opsional: { produk_id } kalau dipanggil dari trigger stok spesifik.
    // Kalau kosong (dipanggil dari cron), cek SEMUA produk aktif.
    let body: RequestBody = {};
    try { body = await req.json(); } catch (_) { /* body kosong, dari cron */ }

    let produkQ = sb.from("produk").select("id, nama, stok_minimum, aktif").eq("aktif", true);
    if (body.produk_id) produkQ = produkQ.eq("id", body.produk_id);
    const { data: produkList, error: eProduk } = await produkQ.returns<ProdukRow[]>();
    if (eProduk) throw eProduk;
    if (!produkList || produkList.length === 0) {
      return json({ ok: true, sent: 0, message: "Tidak ada produk relevan" });
    }

    let stokQ = sb.from("stok_cabang").select("produk_id, cabang_id, stok");
    if (body.produk_id) stokQ = stokQ.eq("produk_id", body.produk_id);
    const { data: stokRows, error: eStok } = await stokQ.returns<StokCabangRow[]>();
    if (eStok) throw eStok;

    const { data: cabangList } = await sb.from("cabang").select("id, nama").returns<CabangRow[]>();
    const cabangMap: Record<number, string> = Object.fromEntries((cabangList || []).map((c) => [c.id, c.nama]));

    // Kumpulkan item yang stoknya menipis/habis, per kombinasi produk+cabang
    type LowItem = { produk_id: number; cabang_id: number; nama: string; cabang: string; stok: number; level: "habis" | "menipis" };
    const lowItems: LowItem[] = [];
    for (const row of stokRows || []) {
      const p = produkList.find((x) => x.id === row.produk_id);
      if (!p) continue;
      const ambang = p.stok_minimum != null && p.stok_minimum !== "" ? Number(p.stok_minimum) : 10;
      if (row.stok <= 0) {
        lowItems.push({ produk_id: row.produk_id, cabang_id: row.cabang_id, nama: p.nama, cabang: cabangMap[row.cabang_id] || "-", stok: row.stok, level: "habis" });
      } else if (row.stok <= ambang) {
        lowItems.push({ produk_id: row.produk_id, cabang_id: row.cabang_id, nama: p.nama, cabang: cabangMap[row.cabang_id] || "-", stok: row.stok, level: "menipis" });
      }
    }
    if (lowItems.length === 0) {
      return json({ ok: true, sent: 0, message: "Tidak ada stok menipis/habis" });
    }

    // Anti-spam: skip item yang barusan (< JEDA_NOTIF_JAM jam lalu) sudah dinotifikasi
    // dengan level yang sama.
    const batasWaktu = new Date(Date.now() - JEDA_NOTIF_JAM * 60 * 60 * 1000).toISOString();
    const toNotify: LowItem[] = [];
    for (const item of lowItems) {
      const { data: lastLog } = await sb
        .from("stok_notif_log")
        .select("level, notified_at")
        .eq("produk_id", item.produk_id)
        .eq("cabang_id", item.cabang_id)
        .order("notified_at", { ascending: false })
        .limit(1)
        .maybeSingle<NotifLogRow>();
      const sudahDinotifBaruBaru = lastLog && lastLog.level === item.level && lastLog.notified_at > batasWaktu;
      if (!sudahDinotifBaruBaru) toNotify.push(item);
    }
    if (toNotify.length === 0) {
      return json({ ok: true, sent: 0, message: "Semua item sudah dinotifikasi baru-baru ini" });
    }

    // Susun isi notifikasi
    const habisCount = toNotify.filter((i) => i.level === "habis").length;
    const menipisCount = toNotify.filter((i) => i.level === "menipis").length;
    const titleParts: string[] = [];
    if (habisCount) titleParts.push(`${habisCount} produk habis`);
    if (menipisCount) titleParts.push(`${menipisCount} stok menipis`);
    const title = "⚠️ " + titleParts.join(" & ");
    const contoh = toNotify.slice(0, 3).map((i) => `${i.nama} (${i.cabang})`).join(", ");
    const bodyText = toNotify.length > 3 ? `${contoh}, +${toNotify.length - 3} lainnya` : contoh;
    const payload = JSON.stringify({ title, body: bodyText, url: "/owner.html" });

    // Kirim ke semua subscriber terdaftar
    const { data: subs, error: eSubs } = await sb.from("push_subscriptions").select("*").returns<PushSubscriptionRow[]>();
    if (eSubs) throw eSubs;

    let sent = 0;
    const expiredEndpoints: string[] = [];
    await Promise.all(
      (subs || []).map(async (s) => {
        const subscription = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
        try {
          await webpush.sendNotification(subscription, payload);
          sent++;
        } catch (err) {
          const wpErr = err as WebPushError;
          if (wpErr.statusCode === 404 || wpErr.statusCode === 410) {
            // Subscription sudah tidak valid (browser uninstall/expire) -> bersihkan
            expiredEndpoints.push(s.endpoint);
          } else {
            console.error("Gagal kirim push ke", s.endpoint, wpErr.message);
          }
        }
      })
    );
    if (expiredEndpoints.length) {
      await sb.from("push_subscriptions").delete().in("endpoint", expiredEndpoints);
    }

    // Catat log supaya item yang sama tidak dikirim ulang dalam JEDA_NOTIF_JAM ke depan
    await sb.from("stok_notif_log").insert(
      toNotify.map((i) => ({
        produk_id: i.produk_id,
        cabang_id: i.cabang_id,
        level: i.level,
        notified_at: new Date().toISOString(),
      }))
    );

    return json({ ok: true, sent, items_notified: toNotify.length, expired_removed: expiredEndpoints.length });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: message }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}