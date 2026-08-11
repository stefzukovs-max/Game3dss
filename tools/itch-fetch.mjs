/**
 * Downloads a free itch.io asset pack.
 *
 * The best CC0 character, weapon and vehicle models on the web are published
 * through itch.io, which has no plain file URLs: a download is a three-step
 * handshake carrying a CSRF token and a session cookie, ending in a signed,
 * short-lived object-store link. That is why these packs were skipped the
 * first time round — but the handshake is stable and scriptable, so it is
 * automation rather than a manual step, and `npm run assets` stays
 * reproducible from a clean clone.
 *
 *   1. GET  /<slug>                    → CSRF token (a hidden input)
 *   2. POST /<slug>/download_url       → a signed download-page URL
 *   3. GET  that page                  → the upload ids on offer
 *   4. POST /<slug>/file/<upload_id>   → the signed object-store link
 *
 * Step 4 is deliberately *not* nested under the signed download URL from step
 * 2, which 404s; it hangs off the game slug and is authorised by the cookie
 * jar built up along the way.
 *
 * Only free packs are fetched. If a project ever stops being free the
 * handshake fails loudly rather than silently downloading nothing.
 */
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/** A cookie jar just large enough for this handshake. */
class Jar {
  constructor() { this.c = new Map(); }
  absorb(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.c.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  get header() { return [...this.c].map(([k, v]) => `${k}=${v}`).join('; '); }
}

const CSRF = /name="csrf_token"[^>]*value="([^"]+)"/;

async function get(url, jar, extra = {}) {
  const res = await fetch(url, { headers: { cookie: jar.header, ...extra }, redirect: 'follow' });
  jar.absorb(res);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res;
}

async function postForm(url, jar, body, extra = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      cookie: jar.header,
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
      ...extra,
    },
    body: new URLSearchParams(body).toString(),
    redirect: 'manual',
  });
  jar.absorb(res);
  return res;
}

/**
 * @param {string} user  itch.io account, e.g. "quaternius"
 * @param {string} slug  project slug, e.g. "50-lowpoly-guns"
 * @param {string} dest  where to write the .zip
 * @returns {Promise<{file: string, name: string, bytes: number}>}
 */
export async function fetchItchPack(user, slug, dest) {
  const jar = new Jar();
  const base = `https://${user}.itch.io/${slug}`;

  const page = await (await get(base, jar)).text();
  const token = page.match(CSRF)?.[1];
  if (!token) throw new Error(`${slug}: no CSRF token — is the project still public?`);

  const urlRes = await postForm(`${base}/download_url`, jar,
    { csrf_token: token }, { referer: base, 'content-type': 'application/json' });
  // download_url wants JSON specifically, so it is re-sent with the right body
  const signed = await (await fetch(`${base}/download_url`, {
    method: 'POST',
    headers: { cookie: jar.header, 'content-type': 'application/json', 'x-requested-with': 'XMLHttpRequest', referer: base },
    body: JSON.stringify({ csrf_token: token }),
  }).then((r) => { jar.absorb(r); return r; })).json().catch(() => null);

  const dlUrl = signed?.url;
  if (!dlUrl) throw new Error(`${slug}: no download URL (status ${urlRes.status}) — the pack may not be free`);

  const dlPage = await (await get(dlUrl, jar, { referer: base })).text();
  const uploads = [...dlPage.matchAll(/data-upload_id="(\d+)"/g)].map((m) => m[1]);
  const names = [...dlPage.matchAll(/class="name">([^<]+)</g)].map((m) => m[1]);
  if (!uploads.length) throw new Error(`${slug}: download page listed no files`);
  const pageToken = dlPage.match(CSRF)?.[1] ?? token;

  // Prefer a glTF build when the pack offers several formats; otherwise take
  // the first upload, which for these packs is the everything-included zip.
  let pick = uploads.findIndex((_, i) => /gltf|glb/i.test(names[i] ?? ''));
  if (pick < 0) pick = 0;

  const fileRes = await postForm(
    `${base}/file/${uploads[pick]}?source=game_download`, jar,
    { csrf_token: pageToken }, { referer: dlUrl });
  const link = (await fileRes.json().catch(() => null))?.url;
  if (!link) throw new Error(`${slug}: file endpoint gave no link (status ${fileRes.status})`);

  await fs.mkdir(path.dirname(dest), { recursive: true });
  const bin = await fetch(link);
  if (!bin.ok) throw new Error(`${slug}: object store → ${bin.status}`);
  await pipeline(Readable.fromWeb(bin.body), createWriteStream(dest));

  return { file: dest, name: names[pick] ?? path.basename(dest), bytes: (await fs.stat(dest)).size };
}

/* CLI: node tools/itch-fetch.mjs quaternius 50-lowpoly-guns /tmp/guns.zip */
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const [user, slug, dest] = process.argv.slice(2);
  if (user && slug && dest) {
    const r = await fetchItchPack(user, slug, dest);
    console.log(`${r.name} → ${r.file} (${(r.bytes / 1e6).toFixed(2)} MB)`);
  }
}
