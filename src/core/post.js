import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';

/**
 * Post-processing chain, assembled per quality tier.
 *
 *   render → GTAO → bloom → tonemap/output → FXAA
 *
 * GTAO is the single biggest contributor: without contact darkening, every
 * object looks like it is hovering a centimetre above whatever it is standing
 * on, which is most of why untouched real-time geometry reads as "flat".
 * Bloom sells the sun and the muzzle flashes; FXAA cleans the stair edges
 * that would otherwise crawl.
 */
export class PostChain {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = null;
    this.enabled = false;
    this.passes = {};
  }

  /**
   * @param {'minimal'|'lite'|'full'} level
   *
   * Even the cheapest tier keeps a composer with a single output pass. Three
   * skips in-shader tone mapping when rendering into a render target, so a
   * scene that sometimes goes through the composer and sometimes doesn't would
   * expose differently on each path — and the raw-GLSL sky, which three never
   * tone maps for us, would blow out on one tier and not the other. One path
   * for every tier is worth the extra full-screen blit.
   */
  build(level) {
    if (this.level === level) return;
    this.dispose();
    this.level = level;

    const { renderer, scene, camera } = this;
    const size = renderer.getSize(new THREE.Vector2());

    const composer = new EffectComposer(renderer, level === 'minimal'
      ? new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.UnsignedByteType })
      : undefined);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(size.x, size.y);
    composer.addPass(new RenderPass(scene, camera));

    if (level === 'full') {
      const gtao = new GTAOPass(scene, camera, size.x, size.y);
      gtao.output = GTAOPass.OUTPUT.Default;
      // tuned for a 140 m map: a large radius smears contact shadows into
      // dirt, a small one disappears at gameplay camera distance
      gtao.updateGtaoMaterial({
        radius: 1.1, distanceExponent: 1.1, thickness: 1.4,
        scale: 1.4, samples: 14, screenSpaceRadius: false,
      });
      gtao.blendIntensity = 0.9;
      composer.addPass(gtao);
      this.passes.gtao = gtao;
    }

    if (level !== 'minimal') {
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        level === 'full' ? 0.34 : 0.24,   // strength
        0.72,                              // radius
        0.92,                              // threshold - only genuinely bright things
      );
      composer.addPass(bloom);
      this.passes.bloom = bloom;
    }

    composer.addPass(new OutputPass());                    // tonemap + colour space
    if (level !== 'minimal') composer.addPass(new FXAAPass());  // after tonemapping, on purpose

    this.composer = composer;
    this.enabled = true;
  }

  setSize(w, h) {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.passes.gtao?.setSize(w, h);
  }

  render(dt) {
    if (this.enabled && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.dispose?.();
    this.composer = null;
    this.passes = {};
    this.enabled = false;
    this.level = null;
  }
}
