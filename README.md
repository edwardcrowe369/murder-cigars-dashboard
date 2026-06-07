# Murder Cigars — Content Dashboard

Plan, review, and approve social posts. Includes a media library, photo reordering,
iTunes/Apple Music song search with previews, and **shareable approval links** so a
client can approve or request changes from their own phone.

## What's in here
```
package.json              # tells Netlify to install the storage library
netlify.toml              # Netlify config (build + functions)
public/
  index.html              # the dashboard (your internal tool)
  review.html             # the page your client opens from a share link
netlify/functions/
  itunes.js               # song search (server-side, no CORS issues)
  posts.js                # stores shared review links + approvals (Netlify Blobs)
  posts-board.js          # the shared team board: all posts, synced in real time
```

## Real-time shared board (NEW)
The whole board now lives on the server, so everyone on your team sees the same
posts and they sync automatically:
- Open the site, look at the top-right of the board for a **Live** indicator.
  Green = synced. Amber = connecting. Red = reconnecting.
- Anyone can create posts, move them through draft -> pending -> approved -> posted,
  edit schedules, and delete. Changes show up for the rest of the team within a
  couple of seconds; no refresh needed.
- The board refreshes every 2 seconds (pauses while the tab is in the background to
  save data).
- The very first time the site loads with an empty server, it publishes the starter
  set of demo posts so the board isn't blank. Delete those whenever you like.
- The **media library stays on each person's own device** by design (so everyone has
  their own working stash); only finished posts are shared to the board.

## IMPORTANT: this version needs a Git-connected deploy (one-time setup)
The approval feature stores posts on Netlify using **Netlify Blobs**, which only
installs during a real build. That means the old drag-and-drop zip method won't
include it. You set this up once, in the browser, no terminal needed:

1. Go to github.com (sign in as curatedbysaint) and create a new repository,
   e.g. `murder-cigars-dashboard`.
2. Click **Add file -> Upload files**, then drag in ALL of these, keeping the
   folders intact: `package.json`, `netlify.toml`, the `public` folder, and the
   `netlify` folder. Commit.
3. Go to Netlify -> **Add new site -> Import an existing project -> GitHub**, pick
   the repo. Netlify reads `netlify.toml` automatically. Click Deploy.
4. Done. From now on, to update the site you just upload the changed file to GitHub
   and Netlify redeploys automatically.

(You can point your existing tmachine.netlify.app site at this repo, or use the new
URL Netlify gives you. Either is fine.)

## How approval sharing works
1. On any draft/pending/approved post, tap **Share**. The dashboard creates a link
   like `your-site.netlify.app/review.html?id=ab12cd` and copies it.
2. Send that link to whoever approves. They open it on any device, see the post
   full-size (photos, caption, song, schedule), and tap **Approve** or **Request
   changes**, with an optional name and comment.
3. Back on your dashboard, tap **Check approval responses** (top of the board).
   Approved posts move to Approved; "request changes" posts move to Denied, and the
   client's comment shows right on the card. It also checks automatically on load.

## Why search needed the server function
Calling iTunes straight from the browser is unreliable (Apple's CORS bug + dropped
JSONP support). `itunes.js` fetches it server-side, so search just works.

## Notes
- The board is shared across your team via the server. The approval **share link**
  still copies just a snapshot of one post for the client; the client never sees your
  whole board.
- Instagram doesn't allow attaching licensed music via API, so the song picker is
  for choosing/referencing the track; whoever publishes adds the audio in-app.
- Very large multi-photo posts (several MB of images) add up on a shared board; keep
  carousels reasonable so syncing stays fast.
