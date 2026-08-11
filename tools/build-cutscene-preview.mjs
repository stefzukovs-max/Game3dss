#!/usr/bin/env node
/**
 * Builds a standalone, single-file preview of both cutscenes.
 *
 * The game itself cannot be a shareable single page — it is ~30 MB of textures,
 * models and an HDRI across a few hundred files. The cutscenes can, because
 * they are pure DOM, SVG and CSS with no dependency on the renderer or the
 * asset pack.
 *
 * The whole point is that this inlines `src/ui/cutscene.js` verbatim rather
 * than reimplementing it. There is one script, one set of artwork and one
 * renderer, so the preview cannot drift from what actually plays in the game —
 * which is the failure mode that makes design previews worthless.
 *
 *   node tools/build-cutscene-preview.mjs [outFile]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const out = process.argv[2] ?? path.join(ROOT, 'cutscene-preview.html');

const src = await fs.readFile(path.join(ROOT, 'src', 'ui', 'cutscene.js'), 'utf8');
// strip the module keywords so it can run inside a plain <script> without the
// page needing to be a module graph of its own
const inline = src
  .replace(/^export const/m, 'const')
  .replace(/^export function/gm, 'function');

// the wordmark is lifted from index.html rather than redrawn, for the same
// reason the script is: one mark, one source, no drift
const html = await fs.readFile(path.join(ROOT, 'index.html'), 'utf8');
const mark = html.slice(html.indexOf('<svg class="mark-word"'),
  html.indexOf('</svg>', html.indexOf('<svg class="mark-word"')) + 6);

const page = `<title>ESCADÃO — opening sequences</title>
<style>
  /*
   * Deliberately single-theme. These are night openings on an ink ground; a
   * light variant would fight the piece rather than serve it. Every colour is
   * therefore painted explicitly so the page holds on either host ground.
   */
  :root{
    --ink:#0a0a0c; --ink-2:#141418; --bone:#efe9dc;
    --dim:rgba(239,233,220,.56); --hair:rgba(239,233,220,.16);
    --gang:#ffd200; --gang-2:#ff5a1f;
    --cop:#37b6ff;  --cop-2:#0b64c8;
    --font:"Oswald","Barlow Condensed","Archivo Narrow","Roboto Condensed","Arial Narrow",Impact,system-ui,sans-serif;
    color-scheme:dark;
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{min-height:100%}
  body{
    background:var(--ink); color:var(--bone); font-family:var(--font);
    display:grid; place-content:center; justify-items:start;
    gap:clamp(18px,3vh,30px); padding:clamp(28px,7vh,72px) clamp(20px,7vw,84px);
    -webkit-font-smoothing:antialiased;
  }
  /* print grain, the same device the game's interface uses */
  body::after{
    content:''; position:fixed; inset:0; pointer-events:none; z-index:9;
    background:radial-gradient(rgba(0,0,0,.55) 1px,transparent 1.3px);
    background-size:4px 4px; opacity:.17; mix-blend-mode:overlay;
  }

  .mark-word{display:block;width:min(58vw,540px);height:auto;
    transform:rotate(-1.1deg);filter:drop-shadow(3px 3px 0 var(--gang-2))}
  .mark-fill{fill:var(--bone)}
  .mark-til{fill:none;stroke:var(--gang);stroke-width:11;stroke-linecap:round}
  .rule{display:block;height:5px;width:min(58vw,540px);background:var(--gang);
    transform:rotate(-1.1deg);
    clip-path:polygon(0 0,100% 12%,99.4% 100%,.6% 84%)}
  .sub{font-size:clamp(10px,1.1vw,13px);letter-spacing:.42em;font-weight:600;
    color:var(--dim);text-transform:uppercase;transform:rotate(-1.1deg)}

  .brief{
    position:relative;max-width:46ch;padding:15px 18px 14px;
    background:linear-gradient(180deg,rgba(239,233,220,.055),rgba(239,233,220,.02));
    border:1px solid var(--hair);border-left:3px solid var(--gang);
    transform:rotate(.5deg);
  }
  .brief::before{content:'';position:absolute;top:-9px;left:18px;width:66px;height:19px;
    background:rgba(239,233,220,.15);border:1px solid rgba(239,233,220,.12);transform:rotate(-6deg)}
  .brief p{font-size:14px;line-height:1.62;color:var(--dim)}
  .brief b{color:var(--bone);font-weight:600}

  .picks{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
  button{font:inherit;font-size:15px;font-weight:800;letter-spacing:.2em;cursor:pointer;
    padding:16px 34px;border:0;color:var(--ink);transform:skewX(-9deg);transition:none}
  button span{display:inline-block;transform:skewX(9deg)}
  .gang{background:var(--gang);box-shadow:5px 5px 0 var(--gang-2)}
  .cop{background:var(--cop);box-shadow:5px 5px 0 var(--cop-2)}
  button:hover,button:focus-visible{translate:3px 3px;box-shadow:2px 2px 0 var(--ink-2)}
  button:focus-visible{outline:2px solid var(--bone);outline-offset:4px}

  .opts{display:flex;gap:9px;align-items:center;font-size:12px;letter-spacing:.16em;color:var(--dim)}
  .opts input{accent-color:var(--gang);width:15px;height:15px}
  .foot{font-size:11.5px;letter-spacing:.08em;color:rgba(239,233,220,.34);max-width:56ch;line-height:1.6}
  @media (prefers-reduced-motion:reduce){button{transition:none}}
</style>

${mark}
<span class="rule"></span>
<p class="sub">OPENING SEQUENCES</p>

<div class="brief">
  <p><b>Both intros, exactly as they play in the game.</b> Same script, same artwork,
    same renderer — this page inlines the game's own cutscene module rather than
    reproducing it, so what you see here cannot drift from what ships.</p>
</div>

<div class="picks">
  <button class="gang" data-side="gang" type="button"><span>THE LOOKOUTS</span></button>
  <button class="cop" data-side="police" type="button"><span>9TH BATTALION</span></button>
  <label class="opts"><input type="checkbox" id="loop"> LOOP</label>
</div>

<p class="foot">Space, Enter or Escape skips. Each side runs about fifteen seconds.
  Fiction — the hill, the crews, the unit and the city are all invented.</p>

<script>
${inline}

const loop = document.getElementById('loop');
for (const b of document.querySelectorAll('button[data-side]')) {
  b.addEventListener('click', () => playCutscene(b.dataset.side, { loop: loop.checked }));
}
</script>
`;

await fs.writeFile(out, page);
console.log(`${out}  (${(page.length / 1024).toFixed(1)} kB)`);
