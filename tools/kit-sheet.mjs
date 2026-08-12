/**
 * Contact sheet for a modular kit.
 *
 *   node tools/kit-sheet.mjs assets/models/slums/kit.glb
 *
 * A modular kit arrives with its pieces named A1…G4. Those names say where the
 * artist parked them on the display grid and nothing about what they are, and a
 * bounding box cannot tell a wall from a floor from a staircase. So every mesh
 * is rendered on its own, three-quarter view, at a size proportional to nothing
 * — each piece framed to fill its cell — and laid out in a labelled grid. That
 * is the cheapest way to find out that B2 is a corrugated roof and D4 is a
 * balcony floor, which is what the placement code needs to know.
 */
import { chromium } from 'playwright';

const FILE = process.argv[2] ?? 'assets/models/slums/kit.glb';
const OUT = process.env.SHOT_DIR || '.';
const NAME = process.env.NAME || 'kit-sheet';
const CELL = 210;
const COLS = 6;

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
// tall enough to hold the whole sheet: a WebGL page screenshotted with
// `fullPage` past the viewport comes back black below the fold
const p = await b.newPage({ viewport: { width: COLS * (CELL + 12) + 24, height: 2000 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:8080/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(200);

const names = await p.evaluate(async ([file, cell, cols]) => {
  document.querySelectorAll('#overlay, #hud, #scene, #rotate-gate').forEach((el) => el.remove());
  document.body.style.cssText = `margin:0;background:#eceef1;font:12px/1.4 monospace;color:#111;
    display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:12px;padding:12px`;

  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');

  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(cell, cell);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe3e8);
  const hdr = await new HDRLoader().loadAsync('http://localhost:8080/assets/hdri/autumn_field_puresky_1k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = new THREE.PMREMGenerator(r).fromEquirectangular(hdr).texture;
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.0);
  sun.position.set(5, 8, 4);
  scene.add(sun);

  const gltf = await new GLTFLoader().loadAsync('http://localhost:8080/' + file);
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  meshes.sort((a, c) => (a.name || '').localeCompare(c.name || ''));

  const cam = new THREE.PerspectiveCamera(32, 1, 0.02, 500);
  const out = [];
  for (const m of meshes) {
    /*
     * The piece as authored: its own rotation and scale kept, only the
     * display-grid translation dropped. Resetting the whole matrix instead
     * reports a size the placement code would never see — several of these
     * meshes carry a scale of their own, so the local box and the real one
     * disagree by a factor of four.
     */
    m.updateWorldMatrix(true, false);
    const solo = m.clone();
    solo.matrix.copy(m.matrixWorld).setPosition(0, 0, 0);
    solo.matrix.decompose(solo.position, solo.quaternion, solo.scale);
    scene.add(solo);
    const box = new THREE.Box3().setFromObject(solo);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    const rad = Math.max(size.x, size.y, size.z, 0.4) * 1.9;
    cam.position.set(mid.x + rad * 0.9, mid.y + rad * 0.7, mid.z + rad * 1.15);
    cam.lookAt(mid);
    cam.updateProjectionMatrix();
    r.render(scene, cam);
    scene.remove(solo);

    const fig = document.createElement('figure');
    fig.style.cssText = 'margin:0';
    const img = document.createElement('img');
    img.src = r.domElement.toDataURL('image/png');
    img.style.cssText = `width:${cell}px;height:${cell}px;display:block;border:1px solid #b9bfc7`;
    const cap = document.createElement('figcaption');
    cap.textContent = `${m.name}  ${size.x.toFixed(1)}×${size.y.toFixed(1)}×${size.z.toFixed(1)}`;
    fig.append(img, cap);
    document.body.append(fig);
    out.push(m.name);
  }
  await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
  return out;
}, [FILE, CELL, COLS]);

console.log(`${names.length} pieces: ${names.join(' ')}`);
await p.screenshot({ path: `${OUT}/${NAME}.png`, fullPage: true, timeout: 120000 });
console.log(`${OUT}/${NAME}.png`);
await b.close();
