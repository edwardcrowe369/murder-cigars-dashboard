import { getStore } from "@netlify/blobs";

let boardCache = null;
let blobsWorking = false;

async function getBlobs() {
  try {
    const store = getStore("murder-board");
    blobsWorking = true;
    return store;
  } catch (err) {
    console.error("Blobs init failed:", err.message);
    blobsWorking = false;
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

function parsePost(p) {
  return {
    id: String(p.id || ""),
    platform: p.platform || "",
    caption: p.caption || "",
    time: p.time || "",
    date: p.date || "",
    tags: Array.isArray(p.tags) ? p.tags : [],
    status: p.status || "draft",
    library: Array.isArray(p.library) ? p.library.slice() : [],
    reviewId: p.reviewId || "",
    reviewUrl: p.reviewUrl || "",
    reviewNotes: p.reviewNotes || "",
    reviewStatus: p.reviewStatus || "pending",
  };
}

function cleanPost(p) {
  const out = parsePost(p);
  out.caption = (out.caption || "").substring(0, 5000);
  out.tags = out.tags.slice(0, 20);
  out.library = out.library.slice(0, 50);
  return out;
}

export default async function handler(event, context) {
  const method = event.httpMethod || "GET";
  let rev = -1;
  try {
    const qs = (event.queryStringParameters) || {};
    rev = parseInt(qs.rev != null ? qs.rev : "-1", 10);
    if (Number.isNaN(rev)) rev = -1;
  } catch (e) {
    rev = -1;
  }

  try {
    const store = await getBlobs();
    let board = boardCache || (await readBoard(store));

    if (!board) {
      board = { rev: 0, posts: [], updatedAt: new Date().toISOString() };
      boardCache = board;
      if (store) await writeBoard(store, board);
    }

    if (method === "GET") {
      if (rev === board.rev) {
        return {
          statusCode: 200,
          body: JSON.stringify({ rev: board.rev, changed: false }),
        };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({ rev: board.rev, posts: board.posts }),
      };
    }

    if (method === "POST") {
      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch (e) {
        return { statusCode: 400, body: "Invalid JSON" };
      }

      const { action: act, post, postId, posts: seedPosts } = body;

      if (act === "seed" && board.posts.length === 0 && seedPosts) {
        board.posts = seedPosts.map(cleanPost).slice(0, 300);
        board.rev++;
        board.updatedAt = new Date().toISOString();
        boardCache = board;
        if (store) await writeBoard(store, board);
        return {
          statusCode: 200,
          body: JSON.stringify({ rev: board.rev, posts: board.posts }),
        };
      }

      if (act === "create" && post) {
        const clean = cleanPost(post);
        const existing = board.posts.find((p) => String(p.id) === String(clean.id));
        if (!existing) {
          board.posts.unshift(clean);
          if (board.posts.length > 300) board.posts.pop();
        }
        board.rev++;
        board.updatedAt = new Date().toISOString();
        boardCache = board;
        if (store) await writeBoard(store, board);
        return {
          statusCode: 200,
          body: JSON.stringify({ rev: board.rev, posts: board.posts }),
        };
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
        board.rev++;
        board.updatedAt = new Date().toISOString();
        boardCache = board;
        if (store) await writeBoard(store, board);
        return {
          statusCode: 200,
          body: JSON.stringify({ rev: board.rev, posts: board.posts }),
        };
      }

      if (act === "delete" && postId) {
        board.posts = board.posts.filter((p) => String(p.id) !== String(postId));
        board.rev++;
        board.updatedAt = new Date().toISOString();
        boardCache = board;
        if (store) await writeBoard(store, board);
        return {
          statusCode: 200,
          body: JSON.stringify({ rev: board.rev, posts: board.posts }),
        };
      }

      return { statusCode: 400, body: "Unknown action" };
    }

    return { statusCode: 405, body: "Method not allowed" };
  } catch (err) {
    console.error("Handler error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}
