import { getStore } from "@netlify/blobs";

// Netlify Function (v2): /.netlify/functions/posts
// Shared review/approval records, stored in Netlify Blobs.
//   POST {action:"share", post:{...}}                          -> { id }
//   GET  ?id=<id>                                              -> stored record
//   POST {action:"decision", id, decision, comment, reviewer}  -> { ok:true }
//
// Uses the v2 function format so Blobs context is provided automatically
// (no connectLambda), matching the working posts-board function.

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: HEADERS });
}

function getBlobs() {
  try {
    return getStore({ name: "murder-posts", consistency: "strong" });
  } catch (err) {
    console.error("Blobs init failed:", err.message);
    return null;
  }
}

const rid = () =>
  Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);

export default async function handler(req) {
  const method = req.method || "GET";
  if (method === "OPTIONS") return new Response("", { status: 204, headers: HEADERS });

  const store = getBlobs();
  if (!store) return json({ error: "Store init failed" }, 503);

  try {
    if (method === "GET") {
      let id = "";
      try {
        id = (new URL(req.url).searchParams.get("id") || "").trim();
      } catch (e) {
        id = "";
      }
      if (!id) return json({ error: "missing id" }, 400);
      const rec = await store.get(id, { type: "json" });
      if (!rec) return json({ error: "not found" }, 404);
      return json(rec);
    }

    if (method === "POST") {
      let body = {};
      try {
        body = await req.json();
      } catch (e) {
        return json({ error: "Invalid JSON" }, 400);
      }

      if (body.action === "share") {
        const p = body.post || {};
        const id = rid();
        const rec = {
          id,
          createdAt: Date.now(),
          post: {
            images: Array.isArray(p.images) ? p.images.slice(0, 20) : [],
            caption: String(p.caption || ""),
            frame: p.frame || "feed",
            platform: String(p.platform || ""),
            song: String(p.song || ""),
            songArt: String(p.songArt || ""),
            songUrl: String(p.songUrl || ""),
            songPreview: String(p.songPreview || ""),
            day: String(p.day || ""),
            time: String(p.time || ""),
          },
          decision: null,
          comment: "",
          reviewer: "",
          reviewedAt: null,
        };
        await store.setJSON(id, rec);
        return json({ id });
      }

      if (body.action === "decision") {
        const id = String(body.id || "").trim();
        if (!id) return json({ error: "missing id" }, 400);
        const rec = await store.get(id, { type: "json" });
        if (!rec) return json({ error: "not found" }, 404);
        const dec =
          body.decision === "approved"
            ? "approved"
            : body.decision === "denied"
            ? "denied"
            : null;
        if (!dec) return json({ error: "bad decision" }, 400);
        rec.decision = dec;
        rec.comment = String(body.comment || "").slice(0, 2000);
        rec.reviewer = String(body.reviewer || "").slice(0, 120);
        rec.reviewedAt = Date.now();
        await store.setJSON(id, rec);
        return json({ ok: true });
      }

      return json({ error: "unknown action" }, 400);
    }

    return json({ error: "method not allowed" }, 405);
  } catch (err) {
    console.error("Handler error:", err);
    return json({ error: String((err && err.message) || err) }, 500);
  }
}
