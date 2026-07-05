// File: supabase/functions/send-stock-alert/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7"; // Menggunakan modul NPM yang stabil

// Ambil secrets dari Supabase Dashboard
// -> Edge Functions -> send-stock-alert -> Secrets
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Ambang batas default kalau produk tidak punya stok_minimum sendiri
const DEFAULT_LOW_STOCK_THRESHOLD = 10;

// Sama persis dengan logika isStokMenipis() di master.html — supaya
// "Stok Menipis" konsisten di mana pun ditampilkan/dikirim.
function isStokMenipis(stok: number, stokMinimum: number | null, cepatKadaluarsa: boolean | null) {
  if (stok <= 0) return false; // dihitung terpisah sebagai "habis"
  if (cepatKadaluarsa) return false; // dikecualikan, kecuali sudah 0
  const ambang = (stokMinimum === null || stokMinimum === undefined) ? DEFAULT_LOW_STOCK_THRESHOLD : Number(stokMinimum);
  return stok <= ambang;
}

/**
 * Hapus subscription yang sudah tidak valid (404/410) dari database.
 */
async function cleanupSubscription(endpoint: string, supabaseAdmin: SupabaseClient) {
  await supabaseAdmin.from("push_subscriptions").delete().eq("endpoint", endpoint);
  console.log(`Subscription kadaluarsa, dihapus: ${endpoint.slice(0, 40)}...`);
}

serve(async (_req: Request) => {
  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Ambil SEMUA baris stok_cabang dari produk yang AKTIF beserta info
    //    produk terkait (stok_minimum, cepat_kadaluarsa).
    //    cepat_kadaluarsa) — filter "menipis/habis"-nya dilakukan di JS
    //    karena ambangnya beda-beda per produk, tidak bisa difilter lewat .lte() saja.
    const { data: allStok, error: stockError } = await supabaseAdmin
      .from("stok_cabang")
      .select(`
        stok,
        produk!inner ( id, nama, stok_minimum, cepat_kadaluarsa, aktif ),
        cabang ( id, nama )
      `)
      .eq('produk.aktif', true); // Hanya cek produk yang aktif dijual

    if (stockError) throw stockError;

    const habisRows = (allStok || []).filter((r: any) => (r.stok ?? 0) <= 0);
    const menipisRows = (allStok || []).filter((r: any) =>
      isStokMenipis(r.stok ?? 0, r.produk?.stok_minimum ?? null, r.produk?.cepat_kadaluarsa ?? false)
    );

    if (habisRows.length === 0 && menipisRows.length === 0) {
      console.log("Stok aman, tidak ada notifikasi yang dikirim.");
      return new Response(JSON.stringify({ message: "Stok aman." }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 2. Ambil semua subscriber notifikasi dari tabel push_subscriptions
    const { data: subscriptions, error: subsError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, subscription"); // Ambil seluruh object JSONB

    if (subsError) throw subsError;
    if (!subscriptions || subscriptions.length === 0) {
      console.log("Tidak ada subscriber notifikasi.");
      return new Response(JSON.stringify({ message: "Tidak ada subscriber." }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 3. Siapkan payload notifikasi
    const describeRow = (r: any) => `${r.produk?.nama || "produk"} (${r.cabang?.nama || "-"})`;
    const totalHabis = habisRows.length;
    const totalMenipis = menipisRows.length;
    const parts: string[] = [];
    if (totalHabis > 0) parts.push(`${totalHabis} stok habis (contoh: ${describeRow(habisRows[0])})`);
    if (totalMenipis > 0) parts.push(`${totalMenipis} stok menipis (contoh: ${describeRow(menipisRows[0])})`);
    const bodyMessage = parts.join(" · ");

    const payload = JSON.stringify({
      title: "⚠️ Peringatan Stok",
      body: bodyMessage,
      url: "owner.html", // Halaman yang dibuka saat notifikasi diklik
    });

    // 4. Kirim notifikasi ke semua subscriber, buang subscription yang sudah
    //    tidak valid lagi (404/410) supaya tabel push_subscriptions tetap bersih.
    const pushPromises = subscriptions.map(async (sub: any) => {
      // Pastikan subscription adalah objek yang valid
      if (!sub.subscription || typeof sub.subscription !== 'object' || !sub.subscription.endpoint) {
        return;
      }
      try {
        await webpush.sendNotification(sub.subscription, payload, {
          vapidDetails: {
            subject: "mailto:admin@srirejeki.app",
            publicKey: VAPID_PUBLIC_KEY,
            privateKey: VAPID_PRIVATE_KEY,
          },
        });
      } catch (err: any) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await cleanupSubscription(sub.endpoint, supabaseAdmin);
        } else {
          console.error(`Gagal kirim ke ${sub.endpoint.slice(0, 40)}...`, err?.body || err);
        }
      }
    });

    await Promise.all(pushPromises);

    console.log(`Notifikasi diproses untuk ${subscriptions.length} perangkat.`);
    return new Response(JSON.stringify({ message: `Notifikasi diproses untuk ${subscriptions.length} perangkat.` }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error di Edge Function:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});