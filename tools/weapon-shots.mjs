/**
 * Turntable portraits of the weapon models.
 *
 * A gun in this game is read at two distances: over the shoulder at maybe a
 * hundred pixels, and in the reload animation right in front of the camera.
 * Both are small enough that the thing carrying the read is the silhouette, so
 * these shots are lit flat and framed side-on where the profile is clearest,
 * plus a three-quarter view for the volumes.
 *
 *   npm run shots:guns
 */
import { chromium } from 'playwright';

const OUT = process.env.SHOT_DIR || '.';
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1100, height: 420 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:8080/', { waitUntil: 'load' });
await p.waitForSelector('#scr-menu:not(.hidden)', { timeout: 150000 });

/*
 * Get the game out of the way. Hiding the menu is not enough on its own — the
 * render loop keeps drawing the level over anything this tool renders, so the
 * loop has to stop rescheduling itself before the canvas is ours.
 */
await p.evaluate(() => {
  document.getElementById('overlay').classList.add('gone');
  document.getElementById('hud').classList.add('hidden');
  const g = window.__game;
  g.state = 'paused';
  g._frame = () => {};          // the pending rAF fires once, then the loop dies
});
await p.waitForTimeout(120);

const IDS = ['pistol', 'smg', 'rifle', 'shotgun'];
// yaw is measured from +Z, and the guns are built along -Z, so a true side
// view is a quarter turn away — yaw 0 would photograph the muzzle end-on.
const Q = Math.PI / 2;
const ANGLES = { side: [Q, 0.02], threequarter: [Q - 0.7, 0.30], top: [Q, 1.25] };

for (const [label, [yaw, pitch]] of Object.entries(ANGLES)) {
  for (const id of IDS) {
    await p.evaluate(async ([wid, yw, pt]) => {
      const THREE = await import('three');
      const { buildWeaponModel } = await import('/src/systems/weapons.js');
      const g = window.__game;

      // a throwaway scene keeps the level's geometry and fog out of the frame
      let s = window.__gunScene;
      if (!s) {
        s = window.__gunScene = new THREE.Scene();
        s.environment = g.scene.environment;
        s.background = new THREE.Color(0x14161a);
        const key = new THREE.DirectionalLight(0xffffff, 3.4);
        key.position.set(-3, 4, 5);
        s.add(key);
        const rim = new THREE.DirectionalLight(0xaac4e8, 1.0);   // cool, but not a blue wash
        rim.position.set(4, 2, -5);
        s.add(rim);
        s.add(new THREE.AmbientLight(0xffffff, 0.55));
        window.__gunCam = new THREE.PerspectiveCamera(28, 1100 / 420, 0.05, 20);
      }
      s.children.filter((c) => c.userData.gun).forEach((c) => s.remove(c));

      const m = buildWeaponModel(wid);
      m.userData.gun = true;
      s.add(m);

      // frame it: measure, then pull the camera back to fit the long axis
      const box = new THREE.Box3().setFromObject(m);
      const size = box.getSize(new THREE.Vector3());
      const mid = box.getCenter(new THREE.Vector3());
      const cam = window.__gunCam;
      // Fit the long axis across the frame rather than guessing a multiplier:
      // the viewport is much wider than it is tall, so fitting to the vertical
      // field of view leaves a rifle occupying a quarter of the picture.
      // Fit whichever axis binds first. Fitting only the long one puts a
      // pistol's full length across the frame and crops its height off.
      const vFov = cam.fov * Math.PI / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * cam.aspect);
      const across = Math.max(size.x, size.z);
      const dist = Math.max(
        (across / 2) / Math.tan(hFov / 2),
        (size.y / 2) / Math.tan(vFov / 2),
      ) * 1.5;
      cam.position.set(
        mid.x + Math.sin(yw) * Math.cos(pt) * dist,
        mid.y + Math.sin(pt) * dist,
        mid.z + Math.cos(yw) * Math.cos(pt) * dist,
      );
      cam.lookAt(mid);
      cam.updateProjectionMatrix();
      g.renderer.setClearColor(0x14161a);
      g.renderer.render(s, cam);
    }, [id, yaw, pitch]);
    await p.waitForTimeout(160);
    await p.screenshot({ path: `${OUT}/gun-${label}-${id}.png` });
  }
  console.log('captured', label);
}
await b.close();
