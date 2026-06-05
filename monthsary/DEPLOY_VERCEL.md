# Vercel Hosted Config

This site can run as a static Vercel site with one API route for shared
configuration saving and one API route for saved visitor responses.

## Required Vercel Setup

1. Create/import the project in Vercel.
2. Add a Redis/KV storage integration from the Vercel Marketplace, such as
   Upstash Redis.
3. Make sure the integration adds these environment variables to the project:
   - `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   - or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`
4. Add one more Vercel environment variable:
   - `CONFIG_ADMIN_TOKEN`
5. Optional, for real Gmail owner login:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_ALLOWED_EMAILS`

Set `CONFIG_ADMIN_TOKEN` to the editor passcode you want to allow for online
saves. If you change the editor passcode inside the site, update this Vercel
environment variable too before expecting online saves to work with the new
code.

For Gmail owner login, create a Google OAuth Web Client ID in Google Cloud and
put that client ID in `GOOGLE_CLIENT_ID`. Put your owner Gmail in
`GOOGLE_ALLOWED_EMAILS`. You can allow multiple owner emails by separating them
with commas.

## How It Works

- Visitors load `content.js` first, so the site always has default content.
- On Vercel, the browser then calls `/api/config` and replaces the defaults with
  the latest saved hosted configuration, if one exists.
- The editor saves to the same `/api/config` endpoint.
- When the visitor finishes the questions, her answers are saved through
  `/api/responses`.
- Owner Edit can load saved responses, download them as CSV, or open a print
  view. Viewing responses requires the same `CONFIG_ADMIN_TOKEN`.
- Memory gallery cards can include optional photo URLs or uploaded photos. The
  editor resizes uploaded photos before saving them. Hosted image links or
  project-relative files such as `./photos/photo.jpg` are still best for large
  galleries.
- After the visitor reaches the final letter, refreshes on that device open the
  keepsake page with the letter and memory gallery instead of restarting the
  fake test. The Owner Edit reset button clears that mode. On Vercel, the reset
  timestamp is saved into hosted config so the visitor's browser can return to
  the normal start page on its next load.
- Local preview still works without hosted storage, but saves stay in that
  browser only, and responses only save online after Vercel storage is set up.
