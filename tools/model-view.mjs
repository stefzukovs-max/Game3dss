/**
 * Turntable a single GLB against the game's own sky and tone mapping.
 *
 *   node tools/model-view.mjs assets/models/police/interceptor.glb [scale]
 *
 * Rendered in its own page rather than inside the running game: dropping a
 * model into the live scene means waiting on a full level build for every look
 * at it, and the map harness is already slow enough on a software renderer.
 */
import { chromium } from 'playwright';

const [, , FILE, SCALE = '1'] = process.argv;
const OUT = process.env.SHOT_DIR || '.';
const NAME = process.env.NAME || 'model';

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const p = await b.newPage({ viewport: { width: 1200, height: 500 } });
p.on('pageerror', (e) => console.log('ERR', e.message));

/*
 * Loaded from the game's own origin rather than a synthetic page: the addons
 * import three by the bare specifier `three`, which only resolves through the
 * import map in index.html — and an import map cannot be injected after the
 * fact. A `setContent` page also fetches cross-origin and is refused outright.
 */
await p.goto('http://localhost:8080/index.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(200);
await p.evaluate(() => {
  document.querySelectorAll('#overlay, #hud, #scene, #rotate-gate').forEach((el) => el.remove());
  document.body.style.cssText = 'margin:0;overflow:hidden;background:#c9ccd2';
});

const info = await p.evaluate(async ([file, scale]) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const { HDRLoader } = await import('three/addons/loaders/HDRLoader.js');

  const r = new THREE.WebGLRenderer({ antialias: true });
  r.setSize(1200, 500);
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 0.9;
  document.body.appendChild(r.domElement);

  const scene = new THREE.Scene();
  // a light ground: the car is black-and-white police livery, and on a dark
  // background the first version of this looked like an empty scene
  scene.background = new THREE.Color(0xc9ccd2);
  const hdr = await new HDRLoader().loadAsync('http://localhost:8080/assets/hdri/autumn_field_puresky_1k.hdr');
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(r);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;

  const isFbx = /\.fbx$/i.test(file);
  const g = await (isFbx ? new FBXLoader() : new GLTFLoader())
    .loadAsync('http://localhost:8080/' + file);
  const obj = isFbx ? g : g.scene;
  obj.scale.setScalar(Number(scale));
  obj.updateMatrixWorld(true);
  scene.add(obj);

  const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
  sun.position.set(6, 9, 5);
  scene.add(sun);

  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const mid = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(32, 1200 / 500, 0.05, 2000);

  // three views round the object, so a collapsed panel cannot hide behind one angle
  const views = [[1.1, 0.45, 1.5], [-1.4, 0.35, 0.9], [0.15, 1.1, -1.6]];
  const radius = Math.max(size.x, size.y, size.z) * 1.5;
  window.__shots = views.map((v) => () => {
    cam.position.set(mid.x + v[0] * radius, mid.y + v[1] * radius, mid.z + v[2] * radius);
    cam.lookAt(mid);
    r.render(scene, cam);
  });
  window.__shots[0]();
  let tris = 0;
  obj.traverse((o) => { if (o.isMesh) tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; });
  return { size: size.toArray().map((n) => +n.toFixed(2)), floor: +box.min.y.toFixed(3), tris: Math.round(tris) };
}, [FILE, SCALE]);

console.log(JSON.stringify(info));
for (let i = 0; i < 3; i++) {
  await p.evaluate((i) => window.__shots[i](), i);
  await p.waitForTimeout(400);
  await p.evaluate((i) => window.__shots[i](), i);
  await p.screenshot({ path: `${OUT}/${NAME}-${i}.png`, timeout: 60000 });
}
await b.close();
