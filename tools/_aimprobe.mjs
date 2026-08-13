import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
const p = await b.newPage();
p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await p.goto('http://localhost:8080/', { waitUntil: 'load' });
await p.waitForSelector('#scr-menu:not(.hidden)', { timeout: 180000 });
console.log((await p.evaluate(async () => {
  const THREE = await import('three');
  const g = window.__game;
  g.selected.operator = 'kite';
  g.settings.intro = false;
  g.startRun();
  g._tick(1 / 60);

  const pl = g.player;
  const out = [];
  // aim straight along -Z from a clear spot
  pl.pos.set(0, 12, 0); pl.yaw = 0; pl.pitch = 0;
  pl.recoilPitch = 0; pl.recoilYaw = 0;
  pl.aiming = true; pl.aimBlend = 1;
  // the model carries the muzzle node; move the player and the model has to
  // follow before anything reads a world position off it
  pl.model.root.position.set(pl.pos.x, pl.pos.y, pl.pos.z);
  pl.model.root.updateMatrixWorld(true);
  pl.updateCamera(g.camera, 0.016, g.world.collision);
  g.camera.updateMatrixWorld(true);

  const camPos = g.camera.position.clone();
  const camDir = g.camera.getWorldDirection(new THREE.Vector3()).clone();
  const muzzle = pl.muzzleWorld(new THREE.Vector3());

  out.push(`player   ${pl.pos.toArray().map(v=>v.toFixed(2))}`);
  out.push(`camera   ${camPos.toArray().map(v=>v.toFixed(2))}  dir ${camDir.toArray().map(v=>v.toFixed(3))}`);
  out.push(`muzzle   ${muzzle.toArray().map(v=>v.toFixed(2))}`);
  out.push(`muzzle offset from camera: ${muzzle.clone().sub(camPos).length().toFixed(2)} m`);

  // where does the camera ray hit?
  const look = g.world.collision.raycast(camPos, camDir, 200, {});
  const dist = look ? look.distance : 200;
  const aimPt = camPos.clone().addScaledVector(camDir, dist);
  out.push(`crosshair lands at ${dist.toFixed(1)} m -> ${aimPt.toArray().map(v=>v.toFixed(2))}`);

  // the direction the bullet actually takes
  const fired = aimPt.clone().sub(muzzle).normalize();
  const err = THREE.MathUtils.radToDeg(fired.angleTo(camDir));
  out.push(`fired dir vs camera dir: ${err.toFixed(2)}°`);

  // now the thing that matters: at a target 12 m ahead, how far off is the shot?
  for (const d of [6, 12, 25, 50]) {
    const target = camPos.clone().addScaledVector(camDir, d);
    const fd = target.clone().sub(muzzle).normalize();
    // where does that ray pass the target plane?
    const hit = muzzle.clone().addScaledVector(fd, target.clone().sub(muzzle).length());
    out.push(`  target ${String(d).padStart(2)}m: shot passes ${hit.distanceTo(target).toFixed(3)} m from it`);
  }
  out.push(`spread ADS = ${pl.weapon.spread(true,0,false).toFixed(4)} rad = ${(pl.weapon.spread(true,0,false)*12*100).toFixed(0)} cm at 12 m`);
  return out;
})).join('\n'));
await b.close();
