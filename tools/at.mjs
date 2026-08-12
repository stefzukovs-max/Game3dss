/** Ad-hoc: list every collision box overlapping a column at x,z. */
import { chromium } from 'playwright';
const [, , X, Z] = process.argv;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto('http://localhost:8080/', { waitUntil: 'load' });
await p.waitForSelector('#scr-menu:not(.hidden)', { timeout: 180000 });
console.log((await p.evaluate(([x, z]) => {
  const c = window.__game.world.collision;
  return c.boxes.filter((o) => !o.off && x > o.x0 - 0.8 && x < o.x1 + 0.8 && z > o.z0 - 0.8 && z < o.z1 + 0.8)
    .map((o) => `${o.tag} x${o.x0.toFixed(2)}..${o.x1.toFixed(2)} y${o.y0.toFixed(2)}..${o.y1.toFixed(2)} z${o.z0.toFixed(2)}..${o.z1.toFixed(2)}`);
}, [Number(X), Number(Z)])).join('\n'));
await b.close();
