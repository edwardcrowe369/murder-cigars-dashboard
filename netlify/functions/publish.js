import { getStore } from "@netlify/blobs";

// Netlify Function (v2): /.netlify/functions/publish
// Publishes a board post to social platforms via Zernio (https://zernio.com).
//   POST { postId, platforms:["instagram","facebook","tiktok","youtube"], scheduleDate? }
//
// Flow:
//   1. GET  /accounts            -> resolve the accountId for each requested platform
//   2. POST /media/presign + PUT -> upload each image, get a public URL (Zernio hosts it)
//   3. POST /posts               -> publish now (or schedule)
//
// The API key is read from the ZERNIO_API_KEY environment variable
// (Netlify -> Site settings -> Environment variables). Never in client code.

const ZERNIO_BASE = "https://zernio.com/api/v1";
const VALID = { instagram: 1, facebook: 1, tiktok: 1, youtube: 1 };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: CORS });
}
function getBoard() {
  try {
    return getStore({ name: "murder-board", consistency: "strong" });
  } catch (e) {
    return null;
  }
}
function parseDataUri(dataUri) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUri || "");
  if (!m) return null;
  return { contentType: m[1], bytes: Buffer.from(m[2], "base64") };
}
function extFor(ct) {
  if (ct === "image/png") return "png";
  if (ct === "image/gif") return "gif";
  if (ct === "image/webp") return "webp";
  return "jpg";
}

export default async function handler(req) {
  const method = req.method || "GET";
  if (method === "OPTIONS") return new Response("", { status: 204, headers: CORS });
  if (method !== "POST") return json({ error: "method not allowed" }, 405);

  const key = process.env.ZERNIO_API_KEY;
  if (!key) {
    return json({ error: "Zernio API key not configured. Add ZERNIO_API_KEY in Netlify environment variables and redeploy." }, 500);
  }
  const auth = { Authorization: "Bearer " + key };

  let body = {};
  try {
    body = await req.json();
  } catch (e) {
    return json({ error: "invalid JSON" }, 400);
  }

  const { postId, platforms, scheduleDate } = body;
  if (!postId) return json({ error: "missing postId" }, 400);

  const wanted = (Array.isArray(platforms) ? platforms : [])
    .map((p) => String(p).toLowerCase())
    .filter((p) => VALID[p]);
  if (!wanted.length) return json({ error: "no valid platforms selected" }, 400);

  const store = getBoard();
  if (!store) return json({ error: "store error" }, 503);
  let board;
  try {
    board = await store.get("board", { type: "json" });
  } catch (e) {
    return json({ error: "board read error" }, 500);
  }
  const post = board && Array.isArray(board.posts)
    ? board.posts.find((p) => String(p.id) === String(postId))
    : null;
  if (!post) return json({ error: "post not found" }, 404);

  try {
    // 1. Resolve connected accounts -> accountId per platform
    const accRes = await fetch(ZERNIO_BASE + "/accounts", { headers: auth });
    const accData = await accRes.json().catch(() => ({}));
    if (!accRes.ok) return json({ error: "Could not list Zernio accounts", detail: accData }, 502);
    const accounts = Array.isArray(accData.accounts) ? accData.accounts : [];

    const platformEntries = [];
    const missing = [];
    for (const p of wanted) {
      const acc = accounts.find((a) => String(a.platform).toLowerCase() === p);
      if (acc && acc._id) platformEntries.push({ platform: p, accountId: acc._id });
      else missing.push(p);
    }
    if (!platformEntries.length) {
      return json({ error: "None of the selected platforms are connected in Zernio. Connect them in your Zernio dashboard first.", missing }, 400);
    }

    // 2. Upload each image via presigned URL (Zernio stores it and returns a public URL)
    const images = Array.isArray(post.images) ? post.images : [];
    const mediaItems = [];
    for (let i = 0; i < images.length; i++) {
      const parsed = parseDataUri(images[i]);
      if (!parsed) continue;
      const fileName = "post-" + postId + "-" + i + "." + extFor(parsed.contentType);
      const pre = await fetch(ZERNIO_BASE + "/media/presign", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, fileType: parsed.contentType }),
      });
      const preData = await pre.json().catch(() => ({}));
      if (!pre.ok || !preData.uploadUrl || !preData.publicUrl) {
        return json({ error: "media presign failed", detail: preData }, 502);
      }
      const put = await fetch(preData.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": parsed.contentType },
        body: new Uint8Array(parsed.bytes),
      });
      if (!put.ok) return json({ error: "media upload failed", status: put.status }, 502);
      mediaItems.push({ url: preData.publicUrl, type: "image" });
    }

    // 3. Create the post (publish now, or schedule)
    const payload = { content: post.caption || "", platforms: platformEntries };
    if (mediaItems.length) payload.mediaItems = mediaItems;
    if (scheduleDate) {
      payload.scheduledFor = String(scheduleDate).replace(/\.\d{3}Z$/, "Z");
      payload.timezone = "UTC";
    } else {
      payload.publishNow = true;
    }

    const postRes = await fetch(ZERNIO_BASE + "/posts", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const postData = await postRes.json().catch(() => ({}));
    if (!postRes.ok) return json({ error: "Zernio rejected the post", status: postRes.status, detail: postData }, 502);

    return json({ ok: true, scheduled: !!scheduleDate, skipped: missing, result: postData });
  } catch (e) {
    return json({ error: "publish request failed", detail: String((e && e.message) || e) }, 502);
  }
}
