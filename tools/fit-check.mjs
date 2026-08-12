/**
 * Viewport fit.
 *
 * Every screen has to be usable on the smallest thing anyone will open it on,
 * and "usable" means the primary action is reachable without scrolling — not
 * merely that the page has no horizontal scrollbar.
 *
 * That distinction is the whole reason this file exists: `mobile-check.mjs`
 * tested `scrollWidth > innerWidth` and passed happily on a landscape phone
 * where the GO UP button was hundreds of pixels below the fold. It was
 * measuring the one axis that was fine.
 *
 * So this measures the other one, on real device sizes, and checks the button
 * you actually have to press is on screen.
 */
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '.';
const URL = process.env.URL || 'http://localhost:8080/';

/* Real sizes, in CSS pixels, after browser chrome is taken off. The landscape
 * phone is the tight one: an iPhone in Safari with the toolbars showing has
 * barely 320 px of height to work with. */
const DEVICES = [
  { name: 'phone landscape', w: 844, h: 320, touch: true },
  { name: 'phone landscape (big)', w: 926, h: 390, touch: true },
  { name: 'phone portrait', w: 390, h: 664, touch: true },
  { name: 'small phone portrait', w: 360, h: 560, touch: true },
  { name: 'tablet', w: 1024, h: 700, touch: true },
  { name: 'laptop', w: 1440, h: 800, touch: false },
];

/* Each screen, and the control that must never be out of reach on it. */
const SCREENS = [
  { id: 'scr-menu', must: '#btn-play', open: null },
  { id: 'scr-opts', must: '#btn-opts-back', open: '#btn-howto' },
];

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});

let failures = 0;
const say = (pass, msg, extra = '') => {
  if (!pass) failures++;
  console.log(` ${pass ? '✓' : '✗'} ${msg}${extra ? '  ' + extra : ''}`);
};

for (const d of DEVICES) {
  const ctx = await browser.newContext({
    viewport: { width: d.w, height: d.h },
    hasTouch: d.touch,
    isMobile: d.touch,
    deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#scr-menu:not(.hidden)', { timeout: 180000 });

  console.log(`\n── ${d.name}  ${d.w}×${d.h} ──`);

  /*
   * In portrait the game puts up a rotate gate over everything, on purpose, so
   * nothing behind it can be clicked. The menu's own layout is still worth
   * measuring there, but the screens that need a click to reach are not
   * reachable by design rather than by fault.
   */
  const gated = await page.evaluate(() => {
    const g = document.getElementById('rotate-gate');
    return !!g && !g.classList.contains('hidden') && getComputedStyle(g).display !== 'none';
  });
  if (gated) console.log('   (rotate gate up — click-through screens skipped)');

  for (const s of SCREENS) {
    if (s.open && gated) continue;
    if (s.open) {
      await page.click(s.open);
      await page.waitForTimeout(250);
    }
    const r = await page.evaluate(([id, must]) => {
      const el = document.getElementById(id);
      if (!el || el.classList.contains('hidden')) return { missing: true };
      const doc = document.documentElement;
      const btn = document.querySelector(must);
      const b = btn?.getBoundingClientRect();
      return {
        // does the document itself scroll? it must not — screens scroll inside
        pageScrollY: doc.scrollHeight > innerHeight + 1,
        pageScrollX: doc.scrollWidth > innerWidth + 1,
        // is the required control on screen and big enough to hit?
        btn: b ? {
          top: Math.round(b.top), bottom: Math.round(b.bottom),
          left: Math.round(b.left), right: Math.round(b.right),
          h: Math.round(b.height),
          visible: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth,
        } : null,
        vh: innerHeight, vw: innerWidth,
      };
    }, [s.id, s.must]);

    if (r.missing) { say(false, `${s.id}: never opened`); continue; }
    say(!r.pageScrollY, `${s.id}: no vertical page overflow`);
    say(!r.pageScrollX, `${s.id}: no horizontal page overflow`);
    say(!!r.btn?.visible, `${s.id}: ${s.must} reachable`,
      r.btn ? `top ${r.btn.top} bottom ${r.btn.bottom} of ${r.vh}` : 'not found');
    // a control you cannot hit with a thumb is not reachable either
    if (d.touch) say((r.btn?.h ?? 0) >= 32, `${s.id}: ${s.must} is thumb-sized`, `${r.btn?.h}px`);

    if (s.open) { await page.click(s.must); await page.waitForTimeout(200); }
  }

  say(errors.length === 0, 'no page errors', errors.slice(0, 2).join(' | '));
  // the capture is a convenience, not the test — a slow software-rendered
  // canvas must not be able to swallow the verdict
  await page.screenshot({ path: `${OUT}/fit-${d.name.replace(/[^a-z]+/gi, '-')}.png`, timeout: 15000 })
    .catch((e) => console.log(`   (no screenshot: ${e.message.split('\n')[0]})`));
  await ctx.close();
}

console.log(failures ? `\n${failures} failure(s)` : '\nevery screen fits');
await browser.close();
process.exit(failures ? 1 : 0);
