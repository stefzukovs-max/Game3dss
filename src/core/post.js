import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * The grade.
 *
 * Three operations, in the order a colourist would do them, applied after
 * tone mapping so the numbers mean what they look like:
 *
 *   LIFT        raises the black point toward a colour rather than toward
 *               grey. This is the single most characteristic thing about the
 *               stylised register — nothing in a game like this is ever
 *               actually black, the darkest thing on screen is a saturated
 *               blue-violet, and that is what stops shadow reading as a hole
 *               in the picture.
 *
 *   SATURATION  a straight boost around luma. Cheap, and doing it after the
 *               tone curve rather than before means the highlights that the
 *               curve compressed get their colour back.
 *
 *   CONTRAST    a gentle S around mid grey to put back the punch that
 *               lifting the blacks took away.
 *
 * Deliberately not a LUT. A 3D lookup texture is the professional answer and
 * would be another file to ship, another thing to author blind, and
 * impossible to tune from a number in a diff.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.34 },
    uContrast: { value: 1.06 },
    uLift: { value: new THREE.Color(0x141a2e) },
    uLiftAmount: { value: 0.055 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform vec3  uLift;
    uniform float uLiftAmount;
    varying vec2 vUv;

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb;

      // lift: fold the darkest end toward a colour, leaving highlights alone
      c = mix(c, uLift + c * (1.0 - uLiftAmount), uLiftAmount * (1.0 - c));

      // saturation about perceptual luma
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);

      // and a gentle S about mid grey
      c = (c - 0.5) * uContrast + 0.5;

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), tex.a);
    }
  `,
};

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

    /*
     * The grade goes after the output pass, on every tier including minimal.
     * It is one full-screen pass with no texture reads beyond its own input,
     * so it is close to free — and it carries most of the art direction, so a
     * phone running the cheap tier should not get a different-looking game.
     */
    const grade = new ShaderPass(GradeShader);
    composer.addPass(grade);
    this.passes.grade = grade;

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
