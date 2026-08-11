/**
 * ══════════════════════════════════════════════════════════════════
 *  CUTSCENES — the opening for each side
 * ══════════════════════════════════════════════════════════════════
 *
 * These are animated flyer panels, not camera flythroughs of the level.
 *
 * That is a deliberate choice rather than a shortcut. A scripted camera move
 * through the map would show exactly what the player is about to walk through
 * anyway, at the resolution of the geometry, and it would need the whole level
 * loaded and lit before a single frame — which is the slowest possible thing
 * to put in front of someone who has just pressed GO UP. Drawn panels in the
 * game's own riso/stencil identity load instantly, say things the level cannot
 * (the coast road, the vans, three years out of date), and set the tone the
 * brand is already committed to.
 *
 * Everything here is data. `SCENES` is the script; `playCutscene` is a small
 * renderer over it. Keeping those apart is what lets the same file drive both
 * the game and the standalone preview built by tools/build-cutscene-preview.mjs
 * — one source of truth, so the preview cannot drift from what ships.
 */

/**
 * A beat is one panel.
 *
 *   ms      how long it holds
 *   art     an SVG id from ART below, drawn behind the text
 *   kicker  small stencilled label, top of the panel
 *   line    the beat itself
 *   radio   optional transmission, typed out under the line
 *   flash   optional colour wash on entry — used for the hard cuts
 */
export const SCENES = {
  gang: {
    side: 'gang',
    title: 'HOLD THE HILL',
    sub: 'until dawn',
    beats: [
      { ms: 3000, art: 'hill', kicker: '23:40 · MORRO DO CRUZEIRO',
        line: 'The road stops at the bottom. After that it is nine hundred steps, and every one of them is ours.' },
      { ms: 3200, art: 'tower', kicker: 'THE TRANSMITTER',
        line: 'The tower carries the baile on Saturdays. It carries everything else the rest of the week.',
        radio: '…and we are still going, still going, all night on the hill…' },
      { ms: 2800, art: 'kite', kicker: 'THE SIGNAL',
        line: 'A kite goes up off the water tanks. One colour is a patrol.',
        radio: 'Kite up. One colour. Coast road.' },
      { ms: 2600, art: 'vans', kicker: '00:12',
        line: 'Two colours is a raid.', flash: true,
        radio: 'Two colours. Two colours. Everybody up.' },
      { ms: 3000, art: 'dark', kicker: 'THE MUSIC STOPS',
        line: 'The lights go out one terrace at a time, all the way to the cross.' },
    ],
  },

  police: {
    side: 'police',
    title: 'TAKE THE TOWER',
    sub: 'before dawn',
    beats: [
      { ms: 3000, art: 'map', kicker: '9TH BATTALION · BRIEFING',
        line: 'The map is three years old. Half of what is on that hill was built after it was printed.' },
      { ms: 3000, art: 'tower', kicker: 'THE OBJECTIVE',
        line: 'One transmitter, bolted to the water tank at the summit. Take it and the hill goes quiet.' },
      { ms: 2800, art: 'vans', kicker: '00:09 · COAST ROAD',
        line: 'Two vans, lights off, up the last stretch of tarmac there is.' },
      { ms: 2600, art: 'hill', kicker: 'END OF THE ROAD',
        line: 'The road ends. The steps start. Nobody drives up from here.', flash: true,
        radio: 'All units, dismount. We go up on foot.' },
      { ms: 3000, art: 'dark', kicker: 'THEY KNOW',
        line: 'Somewhere above you the music cuts out, and the hill stops talking.',
        radio: 'Music just stopped. They called us in before we parked.' },
    ],
  },
};

/* ── artwork ───────────────────────────────────────────────────────
 * Stencil line drawings on a 400×220 stage, stroked in the faction accent.
 * Deliberately sparse: these sit behind text and read for two or three
 * seconds, so anything more detailed would just be noise.
 */
const ART = {
  // the hill in section, with the road ending at its foot
  hill: `<path class="a" d="M0 190 L96 190"/>
    <path class="b" d="M96 190 L150 150 L188 150 L214 116 L250 116 L272 84 L306 84 L330 52 L400 52"/>
    <path class="c" d="M330 52 v-26 M318 34 h24"/>
    <g class="d"><path d="M150 150v-22h26v22M214 116V96h24v20M272 84V64h26v20"/></g>
    <path class="e" d="M96 190 l14-10 M120 190 l14-10 M144 190 l14-10"/>`,
  // the water tower and its transmitter
  tower: `<g class="d"><path d="M150 176V96h100v80"/><path d="M138 96h124"/></g>
    <path class="b" d="M170 96V70h60v26"/>
    <path class="c" d="M200 70V22"/>
    <path class="c" d="M200 30 l-26-18 M200 30 l26-18 M200 52 l-18-12 M200 52 l18-12"/>
    <g class="e"><path d="M248 40a44 44 0 0 1 0 44"/><path d="M262 30a62 62 0 0 1 0 64"/>
      <path d="M152 40a44 44 0 0 0 0 44"/><path d="M138 30a62 62 0 0 0 0 64"/></g>
    <path class="a" d="M60 190h280"/>`,
  // a kite over the rooftops
  kite: `<g class="d"><path d="M40 190v-46h60v46M120 190v-64h54v64M194 190v-38h48v38M262 190v-58h62v58"/></g>
    <path class="a" d="M20 190h360"/>
    <path class="b" d="M300 36 L264 74 L300 112 L336 74 Z"/>
    <path class="c" d="M300 112 v22 M300 134 l-11-5 M300 134 l11-5"/>
    <path class="e" d="M300 112 C280 140 250 150 214 152"/>`,
  // two vans on the coast road
  vans: `<path class="a" d="M0 168h400"/>
    <g class="d"><path d="M60 168v-34h74v34M74 134v-16h30v16"/>
      <path d="M188 168v-34h74v34M202 134v-16h30v16"/></g>
    <g class="b"><circle cx="78" cy="170" r="8"/><circle cx="122" cy="170" r="8"/>
      <circle cx="206" cy="170" r="8"/><circle cx="250" cy="170" r="8"/></g>
    <path class="e" d="M136 146h40M264 146h50"/>
    <path class="c" d="M0 190h120 M160 190h120 M320 190h80"/>`,
  // the briefing map, marked up
  map: `<path class="d" d="M40 24h320v172H40Z"/>
    <path class="e" d="M40 68h320M40 112h320M40 156h320M120 24v172M200 24v172M280 24v172"/>
    <path class="b" d="M96 176 L150 140 L196 108 L248 76 L316 52"/>
    <circle class="c" cx="316" cy="52" r="22"/>
    <path class="c" d="M300 36 l32 32 M332 36 l-32 32"/>
    <path class="a" d="M40 196h140"/>`,
  // the hill going dark, terrace by terrace
  dark: `<path class="b" d="M0 190 L110 190 L150 152 L210 152 L246 114 L300 114 L336 60 L400 60"/>
    <g class="d"><path d="M150 152v-24h28v24M246 114V88h26v26"/></g>
    <path class="c" d="M336 60 v-30 M324 40 h24"/>
    <g class="e"><path d="M28 176h10M52 176h10M76 176h10"/></g>
    <path class="a" d="M0 190h400"/>`,
};

/* ── the renderer ───────────────────────────────────────────────── */

const STYLE = `
.cut{position:fixed;inset:0;z-index:400;background:#0a0a0c;color:#efe9dc;
  display:grid;grid-template-rows:1fr auto;overflow:hidden;
  font-family:"Oswald","Barlow Condensed","Archivo Narrow","Roboto Condensed","Arial Narrow",Impact,system-ui,sans-serif}
.cut[data-side=gang]{--cx:#ffd200;--cx2:#ff5a1f}
.cut[data-side=police]{--cx:#37b6ff;--cx2:#0b64c8}
.cut::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:3;
  background:radial-gradient(rgba(0,0,0,.55) 1px,transparent 1.3px);background-size:4px 4px;
  opacity:.2;mix-blend-mode:overlay}
.cut::before{content:'';position:absolute;inset:0;pointer-events:none;z-index:4;
  background:radial-gradient(ellipse at 50% 45%,transparent 46%,rgba(0,0,0,.72) 100%)}
.cut-stage{position:relative;display:grid;place-items:center;padding:3vh 6vw}
.cut-panel{position:relative;width:min(880px,88vw);opacity:0;transform:translateY(14px);text-align:left}
.cut-panel.in{animation:cutin .5s cubic-bezier(.2,.8,.25,1) forwards}
.cut-panel.out{animation:cutout .32s ease forwards}
@keyframes cutin{to{opacity:1;transform:none}}
@keyframes cutout{to{opacity:0;transform:translateY(-10px)}}
.cut-art{display:block;width:min(100%,620px);height:auto;margin-bottom:20px;overflow:visible}
.cut-art .a{stroke:rgba(239,233,220,.34)}
.cut-art .b{stroke:var(--cx)}
.cut-art .c{stroke:var(--cx2)}
.cut-art .d{stroke:rgba(239,233,220,.72)}
.cut-art .e{stroke:rgba(239,233,220,.30)}
.cut-art path,.cut-art circle{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round;
  stroke-dasharray:var(--len,900);stroke-dashoffset:var(--len,900);
  animation:draw 1.15s cubic-bezier(.3,.9,.3,1) forwards}
@keyframes draw{to{stroke-dashoffset:0}}
.cut-kicker{font-size:clamp(10px,1.1vw,13px);letter-spacing:.36em;font-weight:700;color:var(--cx);
  border-left:3px solid var(--cx);padding-left:10px;margin-bottom:10px}
.cut-line{font-size:clamp(19px,2.5vw,34px);line-height:1.24;font-weight:600;max-width:22ch;
  text-shadow:0 2px 0 rgba(0,0,0,.9)}
.cut-radio{margin-top:16px;font-size:clamp(12px,1.3vw,15px);letter-spacing:.06em;
  color:rgba(239,233,220,.62);padding-left:26px;position:relative;min-height:1.2em}
.cut-radio::before{content:'';position:absolute;left:6px;top:.5em;width:7px;height:7px;
  background:var(--cx);border-radius:50%;animation:tx 1.1s steps(1,end) infinite}
@keyframes tx{0%,60%{opacity:1}61%,100%{opacity:.15}}
.cut-flash{position:absolute;inset:0;background:var(--cx);opacity:0;pointer-events:none;z-index:2}
.cut-flash.go{animation:fl .42s ease-out}
@keyframes fl{0%{opacity:.5}100%{opacity:0}}
.cut-foot{position:relative;z-index:5;display:flex;align-items:center;justify-content:space-between;
  gap:16px;padding:14px clamp(16px,4vw,42px) calc(14px + env(safe-area-inset-bottom,0px))}
.cut-steps{display:flex;gap:6px}
.cut-steps i{width:26px;height:4px;background:rgba(239,233,220,.2);display:block}
.cut-steps i.on{background:var(--cx)}
.cut-skip{background:none;border:1px solid rgba(239,233,220,.3);color:rgba(239,233,220,.75);
  font:inherit;font-size:12px;letter-spacing:.22em;font-weight:700;padding:9px 18px;cursor:pointer;
  clip-path:polygon(0 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%)}
.cut-skip:hover{border-color:var(--cx);color:var(--cx)}
.cut-title{position:absolute;inset:0;display:grid;place-content:center;gap:6px;text-align:center;
  z-index:6;background:#0a0a0c;opacity:0;pointer-events:none}
.cut-title.in{animation:cutin .45s ease forwards}
.cut-title b{font-size:clamp(34px,6.6vw,86px);letter-spacing:.06em;font-weight:800;
  color:var(--cx);text-shadow:5px 5px 0 var(--cx2)}
.cut-title span{font-size:clamp(12px,1.5vw,17px);letter-spacing:.44em;color:rgba(239,233,220,.6)}
@media (prefers-reduced-motion:reduce){
  .cut-panel,.cut-title{animation-duration:.01ms!important}
  .cut-art path,.cut-art circle{animation:none;stroke-dashoffset:0}
  .cut-flash.go{animation:none}
}`;

let styled = false;
function ensureStyle(doc) {
  if (styled) return;
  const el = doc.createElement('style');
  el.textContent = STYLE;
  doc.head.appendChild(el);
  styled = true;
}

/**
 * Play one side's opening.
 *
 * @param {'gang'|'police'} side
 * @param {object} [opts]  `mount` (default document.body), `onLine` (called with
 *                         each radio line, so the game can speak it), `loop`
 * @returns {Promise<void>} resolves when it finishes or is skipped
 */
export function playCutscene(side, opts = {}) {
  const doc = opts.document ?? document;
  const mount = opts.mount ?? doc.body;
  const scene = SCENES[side] ?? SCENES.gang;
  ensureStyle(doc);

  const root = doc.createElement('div');
  root.className = 'cut';
  root.dataset.side = scene.side;
  root.innerHTML = `
    <div class="cut-flash"></div>
    <div class="cut-stage"><div class="cut-panel"></div></div>
    <div class="cut-foot">
      <div class="cut-steps">${scene.beats.map(() => '<i></i>').join('')}</div>
      <button class="cut-skip" type="button">SKIP</button>
    </div>
    <div class="cut-title"><b>${scene.title}</b><span>${scene.sub}</span></div>`;
  mount.appendChild(root);

  const panel = root.querySelector('.cut-panel');
  const flash = root.querySelector('.cut-flash');
  const pips = [...root.querySelectorAll('.cut-steps i')];
  const titleEl = root.querySelector('.cut-title');

  let timer = null;
  let typer = null;
  let done = false;

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    clearInterval(typer);
    root.remove();
    doc.removeEventListener('keydown', onKey);
    resolveIt();
  };

  const onKey = (e) => {
    if (e.code === 'Escape' || e.code === 'Space' || e.code === 'Enter') finish();
  };
  doc.addEventListener('keydown', onKey);
  root.querySelector('.cut-skip').addEventListener('click', finish);

  let resolveIt;
  const promise = new Promise((res) => { resolveIt = res; });

  const show = (i) => {
    if (done) return;
    if (i >= scene.beats.length) return showTitle();
    const b = scene.beats[i];
    pips.forEach((p, k) => p.classList.toggle('on', k <= i));

    panel.classList.remove('in', 'out');
    void panel.offsetWidth;
    panel.innerHTML =
      `<svg class="cut-art" viewBox="0 0 400 220" aria-hidden="true">${ART[b.art] ?? ''}</svg>
       <div class="cut-kicker">${b.kicker}</div>
       <div class="cut-line">${b.line}</div>
       <div class="cut-radio"></div>`;
    panel.classList.add('in');

    /*
     * Give each stroke its own dash length and a staggered start. One shared
     * length makes short strokes finish instantly and long ones lag, which
     * reads as a glitch rather than as something being drawn.
     */
    panel.querySelectorAll('.cut-art path, .cut-art circle').forEach((el, k) => {
      const len = el.getTotalLength ? Math.max(el.getTotalLength(), 1) : 900;
      el.style.setProperty('--len', len.toFixed(1));
      el.style.animationDelay = `${0.05 + k * 0.055}s`;
    });

    if (b.flash) { flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go'); }

    // radio types in, because a transmission arriving all at once is a caption
    const radioEl = panel.querySelector('.cut-radio');
    if (b.radio) {
      opts.onLine?.(b.radio);
      let n = 0;
      clearInterval(typer);
      typer = setInterval(() => {
        radioEl.textContent = b.radio.slice(0, ++n);
        if (n >= b.radio.length) clearInterval(typer);
      }, 26);
    } else {
      radioEl.style.display = 'none';
    }

    timer = setTimeout(() => {
      panel.classList.add('out');
      timer = setTimeout(() => show(i + 1), 300);
    }, b.ms);
  };

  const showTitle = () => {
    titleEl.classList.add('in');
    timer = setTimeout(() => {
      if (opts.loop) { titleEl.classList.remove('in'); show(0); } else finish();
    }, 1900);
  };

  show(0);
  return promise;
}
