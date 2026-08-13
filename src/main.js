import * as THREE from 'three';
import { clamp, now, damp, advanceClock } from './core/utils.js';
import { Input, IS_TOUCH } from './core/input.js';
import { audio } from './core/audio.js';
import { buildFavela, WORLD, TERRACES, zoneAt } from './world/favela.js';
import { NavGraph } from './world/navgraph.js';
import { CombatSystem } from './systems/combat.js';
import { AbilitySystem } from './systems/abilities.js';
import { PickupSystem } from './systems/pickups.js';
import { WaveDirector, PHASE } from './systems/waves.js';
import { applyWeaponMaterials, setWeaponModels } from './systems/weapons.js';
import { drawCards } from './systems/upgrades.js';
import { Player } from './entities/player.js';
import { ROSTER, FACTIONS, rosterFor, byId } from './entities/roster.js';
import { HUD } from './ui/hud.js';
import { PerfHUD } from './ui/perfhud.js';
import { setCharacterDetail, applyCharacterMaterials } from './entities/character.js';
import { setActorSource } from './entities/actor.js';
import { setOutfitMaterials } from './entities/outfit.js';
import { ProceduralSky } from './core/sky.js';
import { PostChain } from './core/post.js';
import { AssetLibrary } from './core/assets.js';
import { scatterProps } from './world/props.js';
import { playCutscene } from './ui/cutscene.js';

const $ = (id) => document.getElementById(id);

/**
 * One drawn icon from the sheet in index.html.
 *
 * These used to be emoji, which render as whatever typeface the platform
 * happens to ship — a different weight, colour and baseline on every machine,
 * and instantly at odds with the rest of the interface.
 */
const glyph = (id) =>
  `<svg class="glyph" aria-hidden="true"><use href="#g-${id}"/></svg>`;

const DIFFICULTY = [
  { name: 'Rookie',   health: 0.80, skill: 0.70, speed: 0.92, damage: 0.55, spread: 1.55 },
  { name: 'Soldier',  health: 1.00, skill: 1.00, speed: 1.00, damage: 0.85, spread: 1.15 },
  { name: 'Veteran',  health: 1.22, skill: 1.14, speed: 1.05, damage: 1.10, spread: 0.92 },
  { name: 'Inferno',  health: 1.55, skill: 1.30, speed: 1.12, damage: 1.45, spread: 0.76 },
];

const STATE = { LOADING: 'loading', MENU: 'menu', PLAYING: 'playing', PAUSED: 'paused',
  DEAD: 'dead', DRAFT: 'draft', OVER: 'over' };

class Game {
  constructor() {
    this.canvas = $('scene');
    this.state = STATE.LOADING;
    this.agents = [];
    this.player = null;
    this.score = 0;
    this.revives = 3;
    this.runStart = 0;
    this.pickedCards = [];
    this.aimingAtHostile = false;

    this.settings = this._loadSettings();
    this.selected = { faction: 'gang', operator: 'kite', difficulty: 1 };

    this._initRenderer();
    this.input = new Input(this.canvas);
    this.input.sensitivity = this.settings.sens;
    this.input.invertY = this.settings.invert;
    this.input.autoFire = this.settings.autofire !== false;
    this.hud = new HUD(this);
    this.perf = new PerfHUD(this);

    this._bindMenus();
    this._buildOperatorUI();
    this._applySettingsToUI();

    this.input.onLockChange((locked) => {
      if (!locked && this.state === STATE.PLAYING) this.pause();
      if (locked) $('scr-lock').classList.add('hidden');
    });

    const onResize = () => { this._resize(); this._checkOrientation(); };
    addEventListener('resize', onResize);
    addEventListener('orientationchange', () => setTimeout(onResize, 250));
    this._checkOrientation();

    // build the level in idle chunks so the loading bar actually moves
    requestAnimationFrame(() => this._load());
  }

  /* ══════════════════ boot ══════════════════ */
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.setClearColor(0x8fb4cf);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    // fog tinted to the sky's own horizon so distance reads as air, not haze
    this.scene.fog = new THREE.Fog(0xd9b892, 95, 330);

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.12, 900);
    this.camera.position.set(0, 12, 40);
    this.camera.userData.shake = 0;

    /*
     * ── lighting ──
     * One sky drives everything: it is the visible dome, the source of the
     * pre-filtered environment map that lights every surface, and the thing
     * the sun direction and colour are read from. Keeping them in sync is
     * what stops the scene looking like objects pasted onto a backdrop.
     */
    this.sky = new ProceduralSky();
    this.skyDome = this.sky.mesh;
    this.scene.add(this.skyDome);
    this.scene.environment = this.sky.generateEnvironment(this.renderer, 256);

    this.ambient = this.sky.makeAmbient();
    this.scene.add(this.ambient);

    this.sun = this.sky.makeSun();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 260;
    const S = 52;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
    // Without this the shadow camera keeps its default ±5 frustum and every
    // surface outside that tiny box samples the shadow map as occluded.
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.045;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // cool bounce from the opposite side so shadowed faces keep their form
    this.fill = new THREE.DirectionalLight(0x9fc4e8, 0.22);
    this.fill.position.set(60, 34, -46);
    this.scene.add(this.fill);

    this.post = new PostChain(this.renderer, this.scene, this.camera);

    this._resize();
  }

  _resize() {
    const s = this.settings.res / 100;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this._pixelCap ?? 2) * s);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(innerWidth, innerHeight);
  }

  /**
   * Rotate a hint while the assets land.
   *
   * These are the things a new player otherwise finds out by dying: that the
   * hill is climbable, that the tower is the objective, that ADS is worth the
   * mobility. Stopped as soon as the menu appears.
   */
  _startTips() {
    const el = $('loadtip');
    if (!el) return;
    const TIPS = [
      'The Escad\u00e3o is the fast way up and the obvious way up. Both sides know it.',
      'Hold right mouse to aim. It costs you speed and pays in accuracy.',
      'Rooftops connect. Ladders and external stairs are not decoration.',
      'The water tower carries the transmitter. Whoever holds it hears the other side coming.',
      'Crouching tightens your aim and drops your silhouette below a parapet.',
      'Reload behind cover, not in it \u2014 a wall you can shoot through is not cover.',
      'Every operator plays differently. Kite is fast and fragile; Boulder is neither.',
      'On a phone, drag the right side of the screen to look and the left stick to move.',
    ];
    let i = Math.floor(Math.random() * TIPS.length);
    const next = () => { el.textContent = TIPS[i++ % TIPS.length]; };
    next();
    this._tipTimer = setInterval(next, 4200);
  }

  _stopTips() { clearInterval(this._tipTimer); this._tipTimer = null; }

  async _load() {
    /*
     * A cold load is forty megabytes, most of it textures and animation, so
     * this screen is on for a while on a first visit. It gets a percentage
     * because a bar alone cannot tell you whether it is nearly done or barely
     * started, and a rotating tip because the wait is long enough to teach
     * something in.
     */
    const show = (p, m) => {
      $('loadfill').style.width = (p * 100) + '%';
      $('loadmsg').textContent = m;
      const pct = $('loadpct');
      if (pct) pct.textContent = Math.round(p * 100) + '%';
    };
    this._startTips();

    const step = (p, msg) => new Promise((r) => {
      show(p, msg);
      requestAnimationFrame(() => setTimeout(r, 0));
    });

    const bar = show;

    /*
     * Assets first, because the world is built out of them. If assets/ is
     * absent the library reports not-ready in a few milliseconds and every
     * consumer below falls back to the procedural path — the game still runs,
     * it just looks like it did before the pack existed.
     */
    await step(0.02, 'Opening the crates…');
    this.assets = new AssetLibrary(this.renderer);
    // 0 → 0.55 of the bar: on a cold cache this genuinely is most of the wait
    await this.assets.load(this._tier(), (p, m) => bar(p * 0.55, m));
    if (this.assets.ready) {
      this._applyEnvironment();
      applyCharacterMaterials(this.assets);
      applyWeaponMaterials(this.assets);
      setWeaponModels(this.assets);
      // real rigged bodies when the pack is there; the capsule rig otherwise
      setOutfitMaterials(this.assets);
      this.skinned = setActorSource(this.assets);
    }

    await step(0.57, 'Waking the hillside…');
    this.world = buildFavela(this.scene, 20240607, (p, m) => bar(0.57 + p * 0.33, m),
      { detail: this.materialDetail !== false, assets: this.assets });
    this.world.bounds = { x0: WORLD.x0 + 7, x1: WORLD.x1 - 7, z0: WORLD.z0 + 7, z1: WORLD.z1 - 7 };

    /*
     * Props go down before the nav graph is plotted and before the broadphase
     * grid is rebuilt: a gas bottle that blocks a doorway has to be something
     * the AI knows about, or it will path straight into it and stall. The
     * collision world rebuilds its grid from scratch, so re-running build()
     * after adding the prop boxes is all that is needed.
     */
    await step(0.91, 'Dressing the hillside…');
    this.props = scatterProps(this.scene, this.assets, this.world, { tier: this._tier() });
    if (this.props) this.world.collision.build();

    await step(0.94, 'Plotting the alleys…');
    this.nav = new NavGraph(this.world.collision);

    await step(0.97, 'Loading the magazines…');
    this.combat = new CombatSystem(this.scene, this.world.collision, this.world.tex);
    this.abilities = new AbilitySystem(this);
    this.pickups = new PickupSystem(this);
    this.waves = new WaveDirector(this);
    this.hud.attachWorld(this.world);
    this._initRevealMarkers();

    await step(1, 'Ready');
    this.state = STATE.MENU;
    this._showScreen('scr-menu');
    this._lastT = performance.now();
    requestAnimationFrame((t) => this._frame(t));
  }

  /**
   * Swap the analytic sky for the photographed one.
   *
   * The HDRI does three jobs at once and they have to stay consistent: it is
   * the visible background, it is the pre-filtered environment every surface
   * samples for ambient and specular, and its brightest pixel tells the
   * directional light where to stand. Driving all three from one file is why
   * the shadows fall the way the sky says they should — set the sun by hand
   * and the scene reads as objects composited onto a photo.
   */
  _applyEnvironment() {
    const a = this.assets;
    if (!a.env) return;

    this.scene.environment?.dispose?.();
    this.scene.environment = a.env;
    this.scene.background = a.background;
    this.scene.backgroundIntensity = 1.0;

    // the procedural dome would now be drawing over the real sky
    this.skyDome.visible = false;

    if (a.sun) {
      this.sun.position.copy(a.sun.dir).multiplyScalar(100);
      this.sun.color.copy(a.sun.color);
    }

    /*
     * Re-balance for a photographed sky.
     *
     * The procedural dome was a dim analytic gradient, so it needed a strong
     * key light and generous exposure to read at all. A real HDRI carries the
     * full outdoor range — the sky alone lights the scene to a sensible level —
     * so leaving the old numbers in place blows every surface to white. The
     * key drops to roughly a real sun's contribution over that ambient, the
     * two crutch lights that existed to stop shadows going black are almost
     * off (the environment does that job properly now), and exposure comes
     * down to where the sky's own highlights stop clipping.
     */
    this.sun.intensity = 2.8;
    this.fill.intensity = 0.05;
    this.ambient.intensity = 0.0;
    this.scene.environmentIntensity = 0.6;
    this._exposure = 0.45;
    this.renderer.toneMappingExposure = this._exposure;

    // fog tinted to the horizon of the sky actually in use, so distance still
    // reads as air rather than as a grey card in front of a photograph
    this.scene.fog.color.set(0xbcc6cf);
    this.renderer.setClearColor(0xbcc6cf);
  }

  /**
   * The resolved tier. `_applyQuality()` runs from the constructor, so this is
   * already settled by the time the asset library asks how much to load.
   */
  _tier() { return this.quality ?? 'medium'; }

  _initRevealMarkers() {
    // "spotted" chevrons that draw through geometry
    const geo = new THREE.PlaneGeometry(0.55, 0.55);
    const mat = new THREE.MeshBasicMaterial({
      map: this.world.tex.spark, color: 0xff4d4d, transparent: true,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.revealMarkers = [];
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 999;
      m.frustumCulled = false;
      this.scene.add(m);
      this.revealMarkers.push(m);
    }
  }

  /* ══════════════════ settings ══════════════════ */
  _loadSettings() {
    const d = {
      sens: 1, tsens: 1, fov: IS_TOUCH ? 82 : 78, vol: 70, invert: false,
      shadows: true, blood: true, dmgnum: true, res: 100,
      quality: 'auto', assist: true, lefty: false, intro: true, autofire: true,
    };
    try { return { ...d, ...JSON.parse(localStorage.getItem('hillcross.settings') || '{}') }; }
    catch { return d; }
  }
  _saveSettings() {
    try { localStorage.setItem('hillcross.settings', JSON.stringify(this.settings)); } catch { /* private mode */ }
  }

  _applySettingsToUI() {
    const s = this.settings;
    $('set-sens').value = s.sens; $('lbl-sens').textContent = (+s.sens).toFixed(2);
    $('set-fov').value = s.fov;   $('lbl-fov').textContent = s.fov;
    $('set-vol').value = s.vol;   $('lbl-vol').textContent = s.vol;
    $('set-res').value = s.res;   $('lbl-res').textContent = s.res + '%';
    $('set-tsens').value = s.tsens; $('lbl-tsens').textContent = (+s.tsens).toFixed(2);
    $('set-invert').checked = s.invert;
    $('set-shadows').checked = s.shadows;
    $('set-intro').checked = s.intro !== false;
    $('set-blood').checked = s.blood;
    $('set-dmgnum').checked = s.dmgnum;
    $('set-assist').checked = s.assist;
    if ($('set-autofire')) $('set-autofire').checked = s.autofire !== false;
    $('set-lefty').checked = s.lefty;
    for (const b of document.querySelectorAll('#seg-quality button')) {
      b.classList.toggle('on', b.dataset.v === s.quality);
    }
    this._applySettings();
  }

  _applySettings() {
    const s = this.settings;
    this.input.sensitivity = +s.sens;
    this.input.autoFire = s.autofire !== false;
    this.input.touchSensitivity = +s.tsens;
    this.input.invertY = s.invert;
    audio.setVolume(s.vol / 100);
    this.camera.fov = +s.fov;
    this.camera.updateProjectionMatrix();
    document.body.classList.toggle('lefty', !!s.lefty);
    this._applyQuality();
    this._saveSettings();
  }

  /* ══════════════════ quality ══════════════════ */

  /**
   * Pick a tier from what the device tells us about itself. Phones get 'low'
   * unless they look genuinely capable — a mid-range handset running a 2048
   * shadow map at full DPR will not hold 30 fps.
   */
  _detectQuality() {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || (IS_TOUCH ? 3 : 8);
    if (IS_TOUCH) return cores >= 8 && mem >= 6 ? 'medium' : 'low';
    return cores <= 4 || mem <= 4 ? 'medium' : 'high';
  }

  _applyQuality() {
    const s = this.settings;
    const q = s.quality === 'auto' ? (this._autoQuality ??= this._detectQuality()) : s.quality;
    this.quality = q;
    const low = q === 'low', med = q === 'medium';

    // resolution
    const cap = low ? 1 : med ? 1.5 : 2;
    this._pixelCap = cap;
    this._resize();

    // shadows
    const shadows = s.shadows && !low;
    this.renderer.shadowMap.enabled = shadows;
    this.sun.castShadow = shadows;
    const mapSize = med ? 1024 : 2048;
    if (shadows && this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }

    // draw distance, model detail, effects, crowd size
    this.scene.fog.near = low ? 45 : 70;
    this.scene.fog.far = low ? 165 : med ? 230 : 300;
    this.camera.far = low ? 420 : 900;
    this.camera.updateProjectionMatrix();
    setCharacterDetail(low ? 0 : 1);
    if (this.combat) this.combat.effectsOn = s.blood && !low;
    this.maxEnemies = low ? 8 : med ? 12 : 18;
    this.allyCap = low ? 2 : med ? 3 : 6;

    // Surface detail is decided once, when the world is built - swapping
    // material maps on a live scene would mean rebuilding every batch.
    this.materialDetail = !low;

    // post-processing: GTAO is the expensive one, so only the top tier gets it
    this.post?.build(low ? 'minimal' : med ? 'lite' : 'full');
    // `_exposure` is set by whichever sky is in use; the low tier skips GTAO,
    // which costs it a little apparent contrast, so it gets a touch more light
    this.renderer.toneMappingExposure = (this._exposure ?? 0.94) * (low ? 1.06 : 1);
  }

  /** Portrait on a phone is unplayable - gate it rather than squeeze it. */
  _checkOrientation() {
    const portrait = innerHeight > innerWidth * 1.02;
    const gate = $('rotate-gate');
    if (!gate) return;
    const show = IS_TOUCH && portrait;
    gate.classList.toggle('hidden', !show);
    if (show && this.state === STATE.PLAYING) this.pause();
  }

  /** Best-effort immersive mode. Must be called from inside a user gesture. */
  _goFullscreen() {
    if (!IS_TOUCH) return;
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    try { req?.call(el)?.catch?.(() => {}); } catch { /* denied is fine */ }
    try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* ditto */ }
  }

  /* ══════════════════ menus ══════════════════ */
  _showScreen(id, transparent = false) {
    const ov = $('overlay');
    ov.classList.remove('gone');
    ov.classList.toggle('transparent', transparent);
    for (const s of ov.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  }
  _hideOverlay() { $('overlay').classList.add('gone'); }

  _bindMenus() {
    // faction tabs
    for (const b of document.querySelectorAll('.ftab')) {
      b.addEventListener('click', () => {
        this.selected.faction = b.dataset.f;
        for (const o of document.querySelectorAll('.ftab')) o.classList.toggle('on', o === b);
        document.body.classList.toggle('side-police', this.selected.faction === 'police');
        this.selected.operator = rosterFor(this.selected.faction)[0].id;
        this._buildOperatorUI();
      });
    }

    // difficulty
    for (const b of document.querySelectorAll('#seg-diff button')) {
      b.addEventListener('click', () => {
        this.selected.difficulty = +b.dataset.v;
        for (const o of document.querySelectorAll('#seg-diff button')) o.classList.toggle('on', o === b);
      });
    }

    $('btn-play').addEventListener('click', () => this.startRun());
    $('btn-howto').addEventListener('click', () => { this._optsFrom = 'scr-menu'; this._showScreen('scr-opts'); });
    $('btn-opts-back').addEventListener('click', () => this._showScreen(this._optsFrom || 'scr-menu', this._optsFrom === 'scr-pause'));
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-pause-opts').addEventListener('click', () => { this._optsFrom = 'scr-pause'; this._showScreen('scr-opts', true); });
    $('btn-quit').addEventListener('click', () => this.toMenu());
    $('btn-dead-quit').addEventListener('click', () => this.toMenu());
    $('btn-over-menu').addEventListener('click', () => this.toMenu());
    $('btn-again').addEventListener('click', () => this.startRun());
    $('btn-respawn').addEventListener('click', () => this.respawn());
    $('btn-draft-skip').addEventListener('click', () => this._closeDraft());

    // settings inputs
    const bind = (id, key, fmt, parse = (v) => v) => {
      $(id).addEventListener('input', (e) => {
        const v = e.target.type === 'checkbox' ? e.target.checked : parse(e.target.value);
        this.settings[key] = v;
        if (fmt) $(fmt.id).textContent = fmt.f(v);
        this._applySettings();
      });
    };
    bind('set-sens', 'sens', { id: 'lbl-sens', f: (v) => (+v).toFixed(2) }, parseFloat);
    bind('set-fov', 'fov', { id: 'lbl-fov', f: (v) => v }, parseInt);
    bind('set-vol', 'vol', { id: 'lbl-vol', f: (v) => v }, parseInt);
    bind('set-res', 'res', { id: 'lbl-res', f: (v) => v + '%' }, parseInt);
    bind('set-tsens', 'tsens', { id: 'lbl-tsens', f: (v) => (+v).toFixed(2) }, parseFloat);
    bind('set-invert', 'invert');
    bind('set-assist', 'assist');
    bind('set-autofire', 'autofire');
    bind('set-lefty', 'lefty');

    for (const b of document.querySelectorAll('#seg-quality button')) {
      b.addEventListener('click', () => {
        this.settings.quality = b.dataset.v;
        for (const o of document.querySelectorAll('#seg-quality button')) o.classList.toggle('on', o === b);
        this._applySettings();
      });
    }

    // on-screen pause (touch has no Esc)
    $('btn-pause')?.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.state === STATE.PLAYING) this.pause();
    }, { passive: false });
    $('btn-pause')?.addEventListener('click', () => {
      if (this.state === STATE.PLAYING) this.pause();
    });
    bind('set-shadows', 'shadows');
    bind('set-intro', 'intro');
    bind('set-blood', 'blood');
    bind('set-dmgnum', 'dmgnum');

    // pointer lock / pause
    const wake = () => {
      if (this.state !== STATE.PLAYING) return;
      audio.init(); audio.resume();
      this.input.requestLock();
    };
    this.canvas.addEventListener('click', wake);
    this.canvas.addEventListener('touchstart', wake, { passive: true });
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === STATE.PLAYING) this.pause();
        else if (this.state === STATE.PAUSED) this.resume();
      }
      if (e.code === 'KeyM' && this.state === STATE.PLAYING && this.hud.minimap) {
        this.hud.minimap.rotate = !this.hud.minimap.rotate;
      }
    });
  }

  _buildOperatorUI() {
    const list = $('op-list');
    const faction = this.selected.faction;
    $('faction-blurb').textContent = FACTIONS[faction].blurb;
    list.innerHTML = '';

    for (const c of rosterFor(faction)) {
      const b = document.createElement('button');
      b.className = 'op-card' + (c.id === this.selected.operator ? ' on' : '');
      b.innerHTML =
        `<span class="op-face">${c.name.replace(/^(Cap\.|Sgt\.|Cb\.|Ten\.|Sd\.)\s*/, '')[0]}</span>
         <span class="op-meta"><b>${c.name}</b><span>${c.role}</span></span>
         <span class="op-diff">${[1, 2, 3].map((i) => `<i class="${i <= c.diff ? 'on' : ''}"></i>`).join('')}</span>`;
      b.addEventListener('click', () => {
        this.selected.operator = c.id;
        for (const o of list.children) o.classList.remove('on');
        b.classList.add('on');
        this._renderOperatorDetail(c);
      });
      list.appendChild(b);
    }
    this._renderOperatorDetail(byId(this.selected.operator) || rosterFor(faction)[0]);
  }

  _renderOperatorDetail(c) {
    const s = c.stats;
    const bar = (label, v, max) =>
      `<div class="od-stat"><span>${label}</span>
        <span class="track"><i style="width:${clamp(v / max, 0, 1) * 100}%"></i></span>
        <b>${typeof v === 'number' && v < 3 ? v.toFixed(2) : Math.round(v)}</b></div>`;

    $('op-detail').innerHTML = `
      <div class="od-top">
        <span class="od-name">${c.name}</span>
        <span class="od-tag">${c.tag}</span>
        <span class="od-role">${c.role.toUpperCase()}</span>
      </div>
      <p class="od-quote">${c.quote}</p>
      <p class="od-bio">${c.bio}</p>
      <div class="od-stats">
        ${bar('HEALTH', s.health, 170)}
        ${bar('ARMOUR', s.armor, 90)}
        ${bar('SPEED', s.speed, 1.25)}
        ${bar('CONTROL', s.control, 1.45)}
      </div>
      <div class="od-kit">
        ${c.loadout.map((w, i) => `<span class="chip${i === 0 ? ' hi' : ''}">${w.toUpperCase()}</span>`).join('')}
        <span class="chip">${c.grenades}× GRENADE</span>
        <span class="chip">${c.build.frame.toUpperCase()} FRAME</span>
      </div>
      <div class="od-skill">
        <span class="ic">${glyph(c.passive.icon)}</span>
        <span class="tx"><b>${c.passive.name}</b><p>${c.passive.desc}</p></span>
        <span class="kbd">PASSIVE</span>
      </div>
      <div class="od-skill">
        <span class="ic">${glyph(c.ability.icon)}</span>
        <span class="tx"><b>${c.ability.name}</b><p>${c.ability.desc}</p></span>
        <span class="kbd">E · ${c.ability.cooldown}s</span>
      </div>`;
  }

  /* ══════════════════ run lifecycle ══════════════════ */
  /**
   * Press GO UP.
   *
   * The opening plays first, over a black screen, while nothing else is
   * happening — the level is already built by this point, so the cutscene costs
   * nothing but the time the player chooses to give it. Skipped runs and
   * retries go straight in: watching the same forty seconds after every death
   * is how an intro turns into a tax.
   */
  startRun(opts = {}) {
    audio.init(); audio.resume();

    const char = byId(this.selected.operator);
    const side = char.faction;
    if (this.settings.intro !== false && !opts.skipIntro && !this._seenIntro?.[side]) {
      (this._seenIntro ??= {})[side] = true;
      this._showScreen(null);
      document.body.classList.toggle('side-police', side === 'police');
      playCutscene(side, { onLine: () => audio.click?.(null, 620, 0.12, 0.03) })
        .then(() => this.startRun({ skipIntro: true }));
      return;
    }

    this._teardownRun();

    this.playerFaction = char.faction;
    this.enemyFaction = char.faction === 'gang' ? 'police' : 'gang';
    this.difficulty = DIFFICULTY[this.selected.difficulty];
    this.difficultyMul = this.difficulty;
    document.body.classList.toggle('side-police', this.playerFaction === 'police');

    this.player = new Player(this, char, char.faction);
    this.player.spawnAt(this._playerSpawn());

    this.score = 0;
    this.revives = 3;
    this.runStart = now();
    this.pickedCards = [];
    this.hud.reset();
    this.hud.setScore(0);
    this.hud.setStreak(0);
    $('ab-icon').innerHTML = glyph(char.ability.icon);

    this.pickups.restock(5);
    this.waves.start();

    this.state = STATE.PLAYING;
    this.hud.show(true);
    this._goFullscreen();
    this._enterPlay();

    this.hud.banner(FACTIONS[this.playerFaction].name.toUpperCase(),
      this.playerFaction === 'gang' ? 'Hold the hill' : 'Take the hill');
  }

  /**
   * Hand control back to the game. On desktop that means showing the
   * click-to-capture card; on touch the controls are already on screen, so we
   * go straight in.
   */
  _enterPlay() {
    const ov = $('overlay');
    if (IS_TOUCH) {
      ov.classList.add('gone');
      this.input.requestLock();     // no-op on touch, but clears the lock card
      return;
    }
    ov.classList.remove('gone');
    ov.classList.add('transparent');
    for (const sc of ov.querySelectorAll('.screen')) {
      sc.classList.toggle('hidden', sc.id !== 'scr-lock');
    }
    this.input.requestLock();
  }

  _playerSpawn() {
    const list = this.world.meta.spawns[this.playerFaction];
    // start in the middle of your own half, not on the very edge
    const t = this.playerFaction === 'gang' ? TERRACES[3] : TERRACES[0];
    let best = list[0], bd = Infinity;
    for (const s of list) {
      const d = Math.abs(s.z - (t.z0 + t.z1) / 2);
      if (d < bd) { bd = d; best = s; }
    }
    return best ?? new THREE.Vector3(0, 20, 0);
  }

  _teardownRun() {
    for (const a of this.agents) a.dispose();
    this.agents.length = 0;
    if (this.player) {
      this.scene.remove(this.player.model.root);
      this.player = null;
    }
    this.abilities?.clear();
    this.pickups?.clear();
    this.combat?.clearDecals();
    this.waves?.reset();
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.input.exitLock();
    this.input.releaseAll();
    $('pause-stats').innerHTML = this._statBlocks();
    this._showScreen('scr-pause', true);
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAYING;
    this._enterPlay();
  }

  toMenu() {
    this._teardownRun();
    this.state = STATE.MENU;
    this.hud.show(false);
    this.input.exitLock();
    document.body.classList.toggle('side-police', this.selected.faction === 'police');
    this._showScreen('scr-menu');
  }

  /* ══════════════════ combat plumbing ══════════════════ */
  allUnits() {
    return this.player ? [this.player, ...this.agents] : this.agents;
  }

  enemiesOf(unit) {
    const out = [];
    if (this.player && this.player.faction !== unit.faction && this.player.alive) out.push(this.player);
    for (const a of this.agents) if (a.faction !== unit.faction && a.alive) out.push(a);
    return out;
  }

  livingTargets(shooter) { return this.enemiesOf(shooter); }

  /** Where an AI wants to go when it has nobody to shoot. */
  objectiveFor(agent) {
    if (agent.faction === this.playerFaction) {
      // allies rally on the player, then push past them
      return this.player?.alive ? this.player.pos : this._factionAnchor(this.enemyFaction);
    }
    // enemies push the player's half of the hill
    return this.player?.alive ? this.player.pos : this._factionAnchor(this.playerFaction);
  }

  _factionAnchor(faction) {
    const t = faction === 'gang' ? TERRACES[TERRACES.length - 1] : TERRACES[0];
    return _anchor.set(0, t.y, (t.z0 + t.z1) / 2);
  }

  applyDamage(target, amount, source, zone, point) {
    if (!target?.alive) return;
    // remembered so the kill handler can pay out a headshot without the death
    // path needing to know how the shot was resolved
    target.lastHitHead = zone === 'head';
    const isPlayerVictim = target.isPlayer;
    const fromPlayer = source === this.player;

    // Second Wind
    if (isPlayerVictim && target.secondWindLeft > 0 && target.health - amount <= 0) {
      target.secondWindLeft--;
      target.health = 1;
      target.armor = Math.max(target.armor, 25);
      target.buffs.speed = 1.4; target.buffs.until = now() + 3;
      target.lastDamaged = now();
      this.hud.banner('SECOND WIND', 'stay up');
      audio.waveClear();
      return;
    }

    const dealt = isPlayerVictim
      ? target.damage(amount, source, 'gunfire')
      : target.takeDamage(amount, source, zone);

    if (fromPlayer) {
      this.player.damageDealt += dealt;
      if (this.player.upgrades.lifesteal > 0) this.player.heal(dealt * this.player.upgrades.lifesteal);
      if (target.alive) {
        this.hud.hitmarker(false, zone === 'head');
        audio.hitmarker(false);
      }
      if (this.settings.dmgnum && point) this.hud.damageNumber(dealt, point, this.camera, zone === 'head');
    }
  }

  onPlayerHit() { /* per-shot feedback lives in applyDamage */ }

  /**
   * A line over the hill's transmitter.
   *
   * The story's whole hook is that the tower is how the hill talks to itself,
   * so the game should actually use it: streaks, spotters and wave changes come
   * through as radio traffic rather than as a system message. It costs one DOM
   * node and it is most of what gives the run a narrator.
   */
  radio(text) {
    this.hud.radio(text);
  }

  /**
   * Each wave one enemy is a spotter, calling the player's position in.
   *
   * This is the objective layer the game was missing. Surviving a wave is a
   * timer; hunting a specific target across the terraces is a decision, and it
   * gives the map's verticality something to be *for*. While a spotter lives
   * the rest of the wave tracks the player harder; killing them pays out and
   * calls off the hunt.
   */
  _markSpotter() {
    const pool = this.agents.filter((a) => a.alive && a.faction === this.enemyFaction && !a.isBoss);
    if (pool.length < 3) return;
    const pick = pool[(Math.random() * pool.length) | 0];
    pick.isMarked = true;
    this.spotter = pick;
    this.hud.setObjective('SPOTTER ON THE HILL', 'They are calling your position — find them');
    this.radio('Somebody is calling us in. Find their radio.');
  }

  _spotterDown(agent) {
    if (this.spotter === agent) this.spotter = null;
    agent.isMarked = false;
    const p = this.player;
    p.weapon.reserve = Math.min(p.weapon.reserve + p.weapon.def.mag * 2, p.weapon.def.maxReserve);
    p.grenades = Math.min(p.grenades + 1, 4);
    this.hud.banner('SPOTTER DOWN', 'ammunition recovered');
    this.hud.setObjective(null);
    this.radio('Their radio is off. We are blind to them again.');
  }

  onAgentDeath(agent, from) {
    agent.model.update(0.016, { speed: 0, dead: true, aiming: false, crouching: false, pitch: 0 });

    if (from === this.player) {
      const p = this.player;
      p.kills++;
      p.streak++;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      const combo = this.hud.addCombo();

      /*
       * Scoring rewards the things that are hard rather than the things that
       * are frequent: a chained kill, a headshot, and the marked spotter. A
       * flat per-kill value makes every fight worth the same and there is
       * nothing to chase.
       */
      const head = !!agent.lastHitHead;
      let mult = 1 + (combo - 1) * 0.22 + (head ? 0.5 : 0);
      if (agent.isMarked) mult += 1.5;
      const gain = Math.round(agent.scoreValue * mult);
      this.score += gain;
      this.hud.setScore(this.score);
      this.hud.setStreak(p.streak);
      this.hud.hitmarker(true, head);
      this.hud.popup((head ? 'HEAD  +' : '+') + gain, head ? '#ff5a1f' : '#ffd200', head ? 36 : 30);
      audio.hitmarker(true);
      this.hud.killfeed('YOU', agent.nameTag, p.weapon.def.short, head, true);
      this.hud.shake(head ? 0.5 : 0.32);

      this._hitstop = head ? 0.10 : 0.07;
      this.camera.userData.shake = Math.max(this.camera.userData.shake, head ? 0.55 : 0.34);

      if (agent.isMarked) this._spotterDown(agent);
      if (agent.isBoss) this.hud.banner('TARGET DOWN', 'heavy push broken');
      this.pickups.dropFrom(agent);

      /*
       * Streak rewards, not just streak text. Every fifth kill without dying
       * tops the magazine back up and calls it over the tower — the run gets
       * materially easier the better you are playing, which is the loop that
       * makes a wave shooter worth pushing.
       */
      if (p.streak > 0 && p.streak % 5 === 0) {
        p.weapon.mag = p.weapon.def.mag;
        p.grenades = Math.min(p.grenades + 1, 4);
        this.hud.banner(`${p.streak} STREAK`, 'resupplied — the tower has you');
        this.radio(p.streak >= 15 ? 'They are not getting past you.'
          : p.streak >= 10 ? 'Whoever that is, keep them there.'
            : 'Reloaded off the drop. Keep going.');
        audio.pickup?.();
      }
    } else if (from && !from.isPlayer) {
      this.hud.killfeed(from.nameTag ?? '—', agent.nameTag, from.weapon?.def.short ?? '', false, false);
    }

    if (this.waves.phase === PHASE.ACTIVE && agent.faction === this.enemyFaction) {
      this.waves.killedThisWave++;
    }
  }

  onPlayerDeath(from, cause) {
    this.state = STATE.DEAD;
    this.input.exitLock();
    this.input.releaseAll();
    this.revives--;

    const killer = from?.nameTag ?? (cause ? `${cause}` : 'the hill');
    $('dead-by').textContent = from
      ? `Taken down by ${killer}.`
      : `Taken down by ${killer}.`;
    $('dead-stats').innerHTML = this._statBlocks();

    if (this.revives < 0) { this.gameOver(false); return; }

    $('btn-respawn').classList.remove('hidden');
    this._respawnAt = now() + 5;
    $('resp-count').textContent = `(${this.revives} left)`;
    this._showScreen('scr-dead', true);
    audio.gameOver();
  }

  respawn() {
    if (this.state !== STATE.DEAD) return;
    const spawns = this.world.meta.spawns[this.playerFaction];
    // respawn away from live hostiles
    let best = spawns[0], bs = -Infinity;
    for (const s of spawns) {
      let d = Infinity;
      for (const a of this.agents) {
        if (a.alive && a.faction === this.enemyFaction) d = Math.min(d, a.pos.distanceTo(s));
      }
      if (d > bs) { bs = d; best = s; }
    }
    this.player.spawnAt(best);
    this.player.abilityCd = Math.min(this.player.abilityCd, 4);
    this.state = STATE.PLAYING;
    this._enterPlay();
    this.hud.banner('BACK UP', `${this.revives} ${this.revives === 1 ? 'life' : 'lives'} left`);
  }

  gameOver(won) {
    this.state = STATE.OVER;
    this.input.exitLock();
    $('over-title').textContent = won ? 'THE HILL HELD' : 'THE HILL FELL';
    $('over-sub').textContent =
      `${FACTIONS[this.playerFaction].name} · ${byId(this.selected.operator).name} · ${this.difficulty.name}`;
    $('over-stats').innerHTML = this._statBlocks(true);
    $('over-build').innerHTML = this.pickedCards.length
      ? this.pickedCards.map((c) => `<span class="chip hi">${glyph(c.icon)} ${c.name}</span>`).join('')
      : '<span class="chip">No upgrades taken</span>';
    this._showScreen('scr-over');
    audio.gameOver();
  }

  _statBlocks(full = false) {
    const p = this.player;
    if (!p) return '';
    const mins = Math.max(0, now() - this.runStart);
    const acc = p.damageDealt > 0 ? p.damageDealt : 0;
    const blocks = [
      ['WAVE', this.waves.wave],
      ['SCORE', this.score.toLocaleString('en-US')],
      ['KILLS', p.kills],
      ['BEST STREAK', p.bestStreak],
    ];
    if (full) {
      blocks.push(['DAMAGE', Math.round(acc)]);
      blocks.push(['TIME', `${Math.floor(mins / 60)}:${String(Math.floor(mins % 60)).padStart(2, '0')}`]);
      blocks.push(['DEATHS', p.deaths]);
    }
    return blocks.map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  }

  /* ══════════════════ draft ══════════════════ */
  onWaveCleared(n) {
    this.pickups.restock(4 + Math.min(4, Math.floor(n / 2)));
    for (const w of Object.values(this.player.weapons)) w.addAmmo(Math.round(w.def.mag * 1.5));
    if (this.player.secondWindLeft !== undefined) {
      this.player.secondWindLeft = this.player.upgrades.secondWind || 0;
    }
    this._openDraft(n);
  }

  _openDraft(wave) {
    this.state = STATE.DRAFT;
    this.input.exitLock();
    this.input.releaseAll();
    const cards = drawCards(3, wave);
    $('draft-title').textContent = `WAVE ${wave} CLEARED`;
    $('draft-sub').textContent = 'Resupply — take one before the next push';
    const box = $('draft-cards');
    box.innerHTML = '';
    for (const c of cards) {
      const b = document.createElement('button');
      b.className = 'card ' + c.rarity;
      b.innerHTML =
        `<span class="cr">${c.rarity.toUpperCase()}</span>
         <div class="ci">${glyph(c.icon)}</div>
         <div class="cn">${c.name}</div>
         <div class="cd">${c.desc}</div>`;
      b.addEventListener('click', () => {
        c.apply(this.player);
        this.pickedCards.push(c);
        audio.pickup();
        this._closeDraft();
      });
      box.appendChild(b);
    }
    this._showScreen('scr-draft', true);
  }

  _closeDraft() {
    this.state = STATE.PLAYING;
    this._enterPlay();
  }

  /* ══════════════════ helpers ══════════════════ */
  shake(pos, amount, radius) {
    if (!this.player) return;
    const d = this.player.pos.distanceTo(pos);
    if (d > radius) return;
    this.camera.userData.shake = Math.min(2.5,
      (this.camera.userData.shake || 0) + amount * (1 - d / radius));
  }

  /* ══════════════════ frame ══════════════════ */
  _frame(t) {
    requestAnimationFrame((n) => this._frame(n));
    const raw = (t - this._lastT) / 1000;
    this._lastT = t;
    const dt = Math.min(0.05, raw);

    if (this.state === STATE.PLAYING) this._tick(dt);
    else if (this.state === STATE.DEAD) {
      this._tickPassive(dt);
      if (this._respawnAt && now() >= this._respawnAt && this.revives >= 0) {
        $('resp-count').textContent = `(${this.revives} left)`;
      }
    } else if (this.state === STATE.MENU) {
      this._orbitMenuCamera(dt);
    } else if (this.state === STATE.PAUSED || this.state === STATE.DRAFT) {
      this.combat?.update(0, this.camera);
    }

    if (this.world) this.renderFrame(dt);
    // after the render: `renderer.info` counts the frame that just went out
    this.perf.sample(raw);
    this.input.endFrame();
  }

  /** Single render entry point, so tools and the game agree on the pipeline. */
  renderFrame(dt = 0.016) {
    this.post.render(dt);
  }

  _tick(dt) {
    /*
     * Hitstop.
     *
     * On a kill the whole simulation drops to a crawl for about seventy
     * milliseconds. It is the single cheapest thing that makes a shooter feel
     * like it has weight: the brain reads the hitch as impact, and without it
     * a body just stops existing. Kept short and scaled rather than frozen, so
     * animation and audio keep moving and it reads as a punch rather than a
     * stutter.
     */
    if (this._hitstop > 0) {
      const bite = Math.min(this._hitstop, dt);
      this._hitstop -= dt;
      dt = dt * 0.12 + (dt - bite) * 0.88;
    }

    advanceClock(dt);
    const p = this.player;

    // ── ability / grenade input ──
    if (this.input.pressed('KeyE')) this.abilities.activate(p);
    if (this.input.pressed('KeyG')) this.abilities.throwGrenade(p);

    p.update(dt, this.input, this.world);
    p.updateCamera(this.camera, dt, this.world.collision);

    for (const a of this.agents) a.update(dt, this);

    // cull corpses so a long run doesn't accumulate bodies
    for (let i = this.agents.length - 1; i >= 0; i--) {
      const a = this.agents[i];
      if (!a.alive && a.deathTime > 12) { a.dispose(); this.agents.splice(i, 1); }
    }

    this.waves.update(dt);
    this.abilities.update(dt);
    this.pickups.update(dt);
    this.combat.update(dt, this.camera);

    this._updateSun();
    this._updateReveal();
    this._updateAimTarget();

    this.hud.update(dt, this);

    if (this.waves.wave >= 30 && this.waves.phase === PHASE.INTERMISSION) this.gameOver(true);
  }

  _tickPassive(dt) {
    advanceClock(dt);
    for (const a of this.agents) a.update(dt, this);
    this.abilities.update(dt);
    this.combat.update(dt, this.camera);
    this.pickups.update(dt);
  }

  /** Keep the shadow frustum on the player, along the sky's own sun axis. */
  _updateSun() {
    const p = this.player;
    if (!p) return;
    this.sun.target.position.copy(p.pos);
    this.sun.position.copy(p.pos).addScaledVector(this.sky.preset.sunDir, 90);
    this.sun.target.updateMatrixWorld();
  }

  _updateReveal() {
    const revealed = this.abilities.revealUntil > now();
    let n = 0;
    for (const m of this.revealMarkers) m.visible = false;
    if (!this.player) return;

    /*
     * The marked spotter is always drawn through walls, whether or not a
     * reveal is up. An objective you cannot locate is not an objective, and
     * the whole point of marking one enemy is that the player goes hunting
     * across the terraces instead of holding a corner.
     */
    if (this.spotter?.alive && n < this.revealMarkers.length) {
      const m = this.revealMarkers[n++];
      m.position.set(this.spotter.pos.x, this.spotter.pos.y + 2.5, this.spotter.pos.z);
      m.quaternion.copy(this.camera.quaternion);
      m.scale.setScalar(1.6 + Math.sin(now() * 5) * 0.18);
      m.visible = true;
      this.spotter.revealed = 0.4;
    }

    if (!revealed) return;
    for (const a of this.agents) {
      if (!a.alive || a.faction === this.playerFaction || a === this.spotter) continue;
      if (n >= this.revealMarkers.length) break;
      const m = this.revealMarkers[n++];
      m.position.set(a.pos.x, a.pos.y + 2.25, a.pos.z);
      m.quaternion.copy(this.camera.quaternion);
      m.scale.setScalar(1);
      m.visible = true;
      a.revealed = 0.4;
    }
  }

  /** Turn the crosshair red when it's over a hostile. */
  _updateAimTarget() {
    const p = this.player;
    if (!p) { this.aimingAtHostile = false; return; }
    this._aimTick = (this._aimTick ?? 0) - 1;
    if (this._aimTick > 0) return;
    this._aimTick = 3;

    const o = this.camera.position;
    const d = this.camera.getWorldDirection(_dir);
    const wall = this.world.collision.raycast(o, d, 140, _hit);
    const maxT = wall ? wall.distance : 140;

    this.aimingAtHostile = false;
    for (const a of this.agents) {
      if (!a.alive || a.faction === this.playerFaction) continue;
      const to = _tmp.subVectors(a.pos, o);
      const along = to.dot(d);
      if (along < 0 || along > maxT) continue;
      const perp = _tmp2.copy(d).multiplyScalar(along).sub(to).length();
      const dy = (o.y + d.y * along) - a.pos.y;
      if (perp < 0.75 && dy > -0.2 && dy < a.standHeight + 0.3) { this.aimingAtHostile = true; break; }
    }
  }

  _orbitMenuCamera(dt) {
    this._menuT = (this._menuT ?? 0) + dt * 0.055;
    const r = 92;
    const a = this._menuT;
    this.camera.position.set(Math.sin(a) * r, 40 + Math.sin(a * 0.7) * 9, Math.cos(a) * r - 10);
    this.camera.lookAt(0, 8, -14);
    this.camera.fov = 58;
    this.camera.updateProjectionMatrix();
  }
}

const _anchor = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _hit = {};

window.addEventListener('error', (e) => {
  const el = document.getElementById('loadmsg');
  if (el) el.textContent = 'Error: ' + e.message;
});

// exposed for debugging from the console
window.__game = new Game();
