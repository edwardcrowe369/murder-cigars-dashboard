// Netlify Function: /.netlify/functions/posts
// Stores shared review posts in Netlify Blobs.
//   POST {action:"share", post:{...}}              -> { id }
//   GET  ?id=<id>                                  -> stored record
//   POST {action:"decision", id, decision, comment, reviewer} -> { ok:true }
//
// Requires @netlify/blobs (installed at build time on a Git-connected deploy).

const { connectLambda, getStore } = require("@netlify/blobs");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const rid = () =>
  Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };

  try {
    connectLambda(event);
    const store = getStore({ name: "murder-posts", consistency: "strong" });

    if (event.httpMethod === "GET") {
      const id = ((event.queryStringParameters && event.queryStringParameters.id) || "").trim();
      if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "missing id" }) };
      const rec = await store.get(id, { type: "json" });
      if (!rec) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "not found" }) };
      return { statusCode: 200, headers: cors, body: JSON.stringify(rec) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");

      if (body.action === "share") {
        const p = body.post || {};
        const id = rid();
        const rec = {
          id,
          createdAt: Date.now(),
          post: {
            images: Array.isArray(p.images) ? p.images : [],
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
        return { statusCode: 200, headers: cors, body: JSON.stringify({ id }) };
      }

      if (body.action === "decision") {
        const id = String(body.id || "").trim();
        if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "missing id" }) };
        const rec = await store.get(id, { type: "json" });
        if (!rec) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: "not found" }) };
        const dec = body.decision === "approved" ? "approved" : body.decision === "denied" ? "denied" : null;
        if (!dec) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "bad decision" }) };
        rec.decision = dec;
        rec.comment = String(body.comment || "").slice(0, 2000);
        rec.reviewer = String(body.reviewer || "").slice(0, 120);
        rec.reviewedAt = Date.now();
        await store.setJSON(id, rec);
        return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
      }

      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "unknown action" }) };
    }

    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method not allowed" }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  }
};
