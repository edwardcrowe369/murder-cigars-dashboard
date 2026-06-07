// Netlify Function: /.netlify/functions/posts-board
// Real-time shared content board, stored as ONE document in Netlify Blobs.
//
//   GET  ?rev=<n>                 -> { rev, posts }            (full board)
//                                    { rev, changed:false }    (when rev matches; tiny response)
//                                    { rev:0, posts:[], empty:true }  (board not seeded yet)
//   POST { action:"seed",   posts:[...] }  -> { rev, posts }   (only if board is empty)
//   POST { action:"create", post:{...}  }  -> { rev, posts }
//   POST { action:"update", post:{...}  }  -> { rev, posts }
//   POST { action:"delete", id:"..."     } -> { rev, posts }
//
// The whole team reads/writes the same document. Mutations are applied to the
// freshest stored copy server-side, so edits to *different* posts never clobber
// each other; simultaneous edits to the *same* post are last-write-wins.
//
// Requires @netlify/blobs (installed at build time on a Git-connected deploy).

const { connectLambda, getStore } = require("@netlify/blobs");

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const KEY = "board";
const MAX_POSTS = 300;

function emptyBoard() {
  return { rev: 0, posts: [], updatedAt: 0 };
}

// Keep only the fields the board needs; guard sizes.
function cleanPost(p) {
  if (!p || typeof p !== "object") return null;
  const id = String(p.id || "").slice(0, 64);
  if (!id) return null;
  return {
    id,
    images: Array.isArray(p.images) ? p.images.slice(0, 12) : [],
    frame: p.frame || "feed",
    caption: String(p.caption || "").slice(0, 4000),
    song: String(p.song || ""),
    songArt: String(p.songArt || ""),
    songUrl: String(p.songUrl || ""),
    songPreview: String(p.songPreview || ""),
    platform: String(p.platform || ""),
    status: String(p.status || "draft"),
    day: String(p.day || ""),
    time: String(p.time || ""),
    // approval-link fields (so the whole team sees shared / approved state)
    reviewId: p.reviewId ? String(p.reviewId) : undefined,
    reviewUrl: p.reviewUrl ? String(p.reviewUrl) : undefined,
    reviewDecision: p.reviewDecision || null,
    reviewComment: p.reviewComment ? String(p.reviewComment).slice(0, 2000) : "",
    reviewer: p.reviewer ? String(p.reviewer).slice(0, 120) : "",
    reviewedAt: p.reviewedAt || null,
    createdAt: p.createdAt || Date.now(),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };

  try {
    connectLambda(event);
    const store = getStore({ name: "murder-board", consistency: "strong" });
    const load = async () => (await store.get(KEY, { type: "json" })) || emptyBoard();
    const save = async (board) => {
      board.updatedAt = Date.now();
      await store.setJSON(KEY, board);
      return board;
    };

    if (event.httpMethod === "GET") {
      const board = await load();
      if (!board.posts || board.posts.length === 0) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ rev: board.rev || 0, posts: [], empty: true }) };
      }
      const clientRev = parseInt((event.queryStringParameters && event.queryStringParameters.rev) || "-1", 10);
      if (clientRev === board.rev) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ rev: board.rev, changed: false }) };
      }
      return { statusCode: 200, headers: cors, body: JSON.stringify({ rev: board.rev, posts: board.posts }) };
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const action = body.action;

      if (action === "seed") {
        const board = await load();
        if (board.posts && board.posts.length > 0) {
          return { statusCode: 200, headers: cors, body: JSON.stringify({ rev: board.rev, posts: board.posts }) };
        }
        const posts = (Array.isArray(body.posts) ? body.posts : []).map(cleanPost).filter(Boolean).slice(0, MAX_POSTS);
        const next = await save({ rev: 1, posts, updatedAt: Date.now() });
        return { statusCode: 200, headers: cors, body: JSON.stringify({ rev: next.rev, posts: next.posts }) };
      }

      if (action === "create") {
        const post = cleanPost(body.post);
        if (!post) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "bad post" }) };
        const board = await load();
        board.posts = board.posts.filter((p) => p.id !== post.id); // dedupe by id
        board.posts.unshift(post);
        if (board.posts.length > MAX_POSTS) board.posts = board.posts.slice(0, MAX_POSTS);
        board.rev = (board.rev || 0) + 1;
        const next = await save(board);
        return { statusCode: 200, headers: cors, body: JSON.stringify({ rev: next.rev, posts: next.posts }) };
      }

      if (action === "update") {
        const post = cleanPost(body.post);
        if (!post) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "bad post" }) };
        const board = await load();
        const i = board.posts.findIndex((p) => p.id === post.id);
        if (i >= 0) board.posts[i] = post;
        else board.posts.unshift(post); // arrived via update but not present yet
        board.rev = (board.rev || 0) + 1;
        const next = await save(board);
        return { statusCode: 200, headers: cors, body: JSON.stringify({ rev: next.rev, posts: next.posts }) };
      }

      if (action === "delete") {
        const id = String(body.id || "");
        const board = await load();
        const before = board.posts.length;
        board.posts = board.posts.filter((p) => p.id !== id);
        if (board.posts.length !== before) board.rev = (board.rev || 0) + 1;
        const next = await save(board);
        return { statusCode: 200, headers: cors, body: JSON.stringify({ rev: next.rev, posts: next.posts }) };
      }

      return { statusCode: 400, headers: cors, body: JSON.stringify({ error: "unknown action" }) };
    }

    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: "method not allowed" }) };
  } catch (e) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ error: String((e && e.message) || e) }) };
  }
};
