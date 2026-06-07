// Netlify Function: /.netlify/functions/itunes?q=<query>
// Fetches the iTunes Search API server-side, so the browser never hits CORS.
// Returns { tracks: [ {id,name,artist,art,url,preview}, ... ] }

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=300",
  };

  const q = ((event.queryStringParameters && event.queryStringParameters.q) || "").trim();
  if (!q) return { statusCode: 200, headers, body: JSON.stringify({ tracks: [] }) };

  try {
    const url =
      "https://itunes.apple.com/search?media=music&entity=song&limit=8&term=" +
      encodeURIComponent(q);
    const r = await fetch(url);
    if (!r.ok) {
      return { statusCode: r.status, headers, body: JSON.stringify({ error: "itunes " + r.status, tracks: [] }) };
    }
    const data = await r.json();
    const tracks = (data.results || [])
      .map((t) => ({
        id: String(t.trackId || (t.trackName + "|" + t.artistName)),
        name: t.trackName || t.collectionName || "",
        artist: t.artistName || "",
        art: (t.artworkUrl100 || t.artworkUrl60 || "").replace("100x100", "160x160"),
        url: t.trackViewUrl || t.collectionViewUrl || "",
        preview: t.previewUrl || "",
      }))
      .filter((x) => x.name);
    return { statusCode: 200, headers, body: JSON.stringify({ tracks }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "fetch failed", tracks: [] }) };
  }
};
