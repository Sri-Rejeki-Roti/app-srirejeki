// File: supabase/functions/send-stock-alert/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.44.4";
import * as webpush from "https://deno.land/x/web_push@0.1.0/mod.ts";

// Ambil secrets dari Supabase Dashboard
// -> Edge Functions -> send-stock-alert -> Secrets
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Ambang batas stok dianggap menipis
const LOW_STOCK_THRESHOLD = 5;

serve(async (_req) => {
  try {
    // Inisialisasi Supabase client dengan hak akses admin (service_role)
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Ambil produk yang stoknya menipis atau habis
    const { data: lowStockProducts, error: stockError } = await supabaseAdmin
      .from("stok_cabang")
      .select(`
        stok,
        produk ( id, nama ),
        cabang ( nama )
      `)
      .lte("stok", LOW_STOCK_THRESHOLD);

    if (stockError) throw stockError;

    if (!lowStockProducts || lowStockProducts.length === 0) {
      console.log("Stok aman, tidak ada notifikasi yang dikirim.");
      return new Response(JSON.stringify({ message: "Stok aman." }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 2. Ambil semua subscriber notifikasi dari tabel push_subscriptions
    const { data: subscriptions, error: subsError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("endpoint, p256dh, auth");

    if (subsError) throw subsError;
    if (!subscriptions || subscriptions.length === 0) {
      console.log("Tidak ada subscriber notifikasi.");
      return new Response(JSON.stringify({ message: "Tidak ada subscriber." }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 3. Siapkan payload notifikasi
    const totalLow = lowStockProducts.length;
    const firstProduct = lowStockProducts[0].produk?.nama || "produk";
    const bodyMessage = totalLow > 1
      ? `Stok ${firstProduct} dan ${totalLow - 1} produk lainnya menipis/habis.`
      : `Stok ${firstProduct} menipis/habis. Segera cek.`;

    const payload = JSON.stringify({
      title: "⚠️ Peringatan Stok Rendah",
      body: bodyMessage,
      url: "owner.html", // Halaman yang dibuka saat notifikasi diklik
    });

    // 4. Kirim notifikasi ke semua subscriber
    const pushPromises = subscriptions.map(sub => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      };
      return webpush.sendNotification(pushSubscription, payload, {
        vapidDetails: {
          subject: "mailto:admin@srirejeki.app",
          publicKey: VAPID_PUBLIC_KEY,
          privateKey: VAPID_PRIVATE_KEY,
        },
      }).catch(err => console.error(`Gagal kirim ke ${sub.endpoint.slice(0,40)}... :`, err.body || err));
    });

    await Promise.all(pushPromises);

    console.log(`Notifikasi terkirim ke ${subscriptions.length} perangkat.`);
    return new Response(JSON.stringify({ message: `Notifikasi terkirim ke ${subscriptions.length} perangkat.` }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("Error di Edge Function:", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});
