import { getStore } from "@netlify/blobs";

let boardCache = null;

function getBlobs() {
  try {
    return getStore({ name: "murder-board", consistency: "strong" });
  } catch (err) {
    console.error("Blobs init failed:", err.message);
    return null;
  }
}

async function readBoard(store) {
  if (!store) return null;
  try {
    const data = await store.get("board");
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error("Blobs read failed:", err.message);
    return null;
  }
}

async function writeBoard(store, data) {
  if (!store) return false;
  try {
    await store.setJSON("board", data);
    return true;
  } catch (err) {
    console.error("Blobs write failed:", err.message);
    return false;
  }
}

function cleanPost(p) {
  return {
    id: String(p.id || ""),
    images: Array.isArray(p.images) ? p.images.slice(0, 20) : [],
    frame: p.frame || "feed",
    caption: (p.caption || "").substring(0, 5000),
    song: p.song || "",
    songArt: p.songArt || "",
    songUrl: p.songUrl || "",
    songPreview: p.songPreview || "",
    platform: p.platform || "",
    status: p.status || "draft",
    day: p.day || "",
    time: p.time || "",
    reviewId: p.reviewId || "",
    reviewUrl: p.reviewUrl || "",
    reviewDecision: p.reviewDecision || null,
    reviewComment: p.reviewComment || "",
    reviewer: p.reviewer || "",
    reviewedAt: p.reviewedAt || null,
    createdAt: p.createdAt || Date.now(),
  };
}

function cleanLib(it) {
  return {
    id: String(it.id || ""),
    src: typeof it.src === "string" ? it.src : "",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadBoard(store) {
  let board = await readBoard(store);
  if (!board) board = boardCache;
  if (!board) {
    board = { rev: 0, posts: [], library: [], updatedAt: new Date().toISOString() };
    if (store) await writeBoard(store, board);
  }
  if (!Array.isArray(board.posts)) board.posts = [];
  if (!Array.isArray(board.library)) board.library = [];
  boardCache = board;
  return board;
}

async function saveBoard(store, board) {
  board.rev++;
  board.updatedAt = new Date().toISOString();
  boardCache = board;
  if (store) await writeBoard(store, board);
  return board;
}

export default async function handler(req, context) {
  const method = req.method || "GET";
  let rev = -1;
  try {
    const url = new URL(req.url);
    const r = url.searchParams.get("rev");
    rev = parseInt(r != null ? r : "-1", 10);
    if (Number.isNaN(rev)) rev = -1;
  } catch (e) {
    rev = -1;
  }

  try {
    const store = getBlobs();
    let board = await loadBoard(store);

    if (method === "GET") {
      if (rev === board.rev) {
        return json({ rev: board.rev, changed: false });
      }
      return json({ rev: board.rev, posts: board.posts, library: board.library });
    }

    if (method === "POST") {
      let body = {};
      try {
        body = await req.json();
      } catch (e) {
        return json({ error: "Invalid JSON" }, 400);
      }

      const { action: act, post, posts: seedPosts } = body;
      const postId = body.postId || body.id;

      if (act === "seed" && board.posts.length === 0 && seedPosts) {
        board.posts = seedPosts.map(cleanPost).slice(0, 300);
        if (Array.isArray(body.library)) {
          board.library = body.library.map(cleanLib).filter((x) => x.id && x.src).slice(0, 200);
        }
        board = await saveBoard(store, board);
        return json({ rev: board.rev, posts: board.posts, library: board.library });
      }

      if (act === "create" && post) {
        const clean = cleanPost(post);
        const existing = board.posts.find((p) => String(p.id) === String(clean.id));
        if (!existing) {
          board.posts.unshift(clean);
          if (board.posts.length > 300) board.posts.pop();
        }
        board = await saveBoard(store, board);
        return json({ rev: board.rev, posts: board.posts, library: board.library });
      }

      if (act === "update" && post && post.id) {
        const idx = board.posts.findIndex((p) => String(p.id) === String(post.id));
        const clean = cleanPost(post);
        if (idx >= 0) {
          board.posts[idx] = clean;
        } else {
          board.posts.unshift(clean);
          if (board.posts.length > 300) board.posts.pop();
        }
        board = await saveBoard(store, board);
        return json({ rev: board.rev, posts: board.posts, library: board.library });
      }

      if (act === "delete" && postId) {
        board.posts = board.posts.filter((p) => String(p.id) !== String(postId));
        board = await saveBoard(store, board);
        return json({ rev: board.rev, posts: board.posts, library: board.library });
      }

      if (act === "libAdd" && Array.isArray(body.items)) {
        const cleaned = body.items.map(cleanLib).filter((x) => x.id && x.src);
        const have = new Set(board.library.map((x) => String(x.id)));
        for (const it of cleaned) {
          if (!have.has(it.id)) {
            board.library.unshift(it);
            have.add(it.id);
          }
        }
        if (board.library.length > 200) board.library = board.library.slice(0, 200);
        board = await saveBoard(store, board);
        return json({ rev: board.rev, posts: board.posts, library: board.library });
      }

      if (act === "libDelete" && Array.isArray(body.ids)) {
        const set = new Set(body.ids.map(String));
        board.library = board.library.filter((x) => !set.has(String(x.id)));
        board = await saveBoard(store, board);
        return json({ rev: board.rev, posts: board.posts, library: board.library });
      }

      return json({ error: "Unknown action" }, 400);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (err) {
    console.error("Handler error:", err);
    return json({ error: err.message }, 500);
  }
}
