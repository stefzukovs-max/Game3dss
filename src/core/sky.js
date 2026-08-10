import * as THREE from 'three';

/**
 * Procedural sky + image-based lighting.
 *
 * The same shader does two jobs: it draws the visible sky dome, and it gets
 * rendered into a pre-filtered cubemap (PMREM) that becomes `scene.environment`.
 * That single fact is what makes the upgrade look "lit" rather than "shaded" —
 * every surface picks up a real ambient specular response from the actual sky
 * above it, so metal reads as metal and a wall in shadow still catches the
 * blue of the sky instead of going flat grey.
 *
 * No assets: it's all analytic, so this costs a few kilobytes of GLSL.
 */

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    // strip translation so the dome is always centred on the viewer
    vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0);
    gl_Position = p.xyww;   // force depth to the far plane
  }
`;

const SKY_FRAG = /* glsl */`
  varying vec3 vDir;
  uniform vec3 uSun;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunColor;
  uniform float uHaze;

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    // sky gradient: zenith → horizon, with a soft haze band at eye level
    float t = clamp(h, 0.0, 1.0);
    vec3 sky = mix(uHorizon, uZenith, pow(t, 0.42));

    // ground hemisphere, so the PMREM gets sensible bounce from below
    vec3 col = mix(uGround, sky, smoothstep(-0.06, 0.06, h));

    // horizon haze thickens toward the sun
    float sunDot = max(dot(d, normalize(uSun)), 0.0);
    float haze = pow(1.0 - abs(h), 7.0) * uHaze;
    col = mix(col, uSunColor, haze * (0.25 + 0.75 * pow(sunDot, 3.0)));

    // sun disc + bloom halo
    float disc = smoothstep(0.9985, 0.9995, sunDot);
    float halo = pow(sunDot, 900.0) * 0.6 + pow(sunDot, 60.0) * 0.14;
    col += uSunColor * (disc * 12.0 + halo);

    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * Golden hour. This is the single highest-value choice in the whole renderer:
 * a low sun rakes across the terraces and throws long shadows down the stairs,
 * which is what gives flat procedural geometry its form. A midday sun lights
 * every surface evenly and the hill reads as cardboard no matter how good the
 * materials are.
 */
export const SKY_PRESET = {
  sunDir: new THREE.Vector3(-0.62, 0.17, 0.76).normalize(),
  zenith: new THREE.Color(0x2a5f9e),
  horizon: new THREE.Color(0xe8b98a),
  ground: new THREE.Color(0x4a4034),
  sunColor: new THREE.Color(0xffb45e),
  haze: 1.15,
  sunIntensity: 4.6,
};

export class ProceduralSky {
  constructor(preset = SKY_PRESET) {
    this.preset = preset;
    this.uniforms = {
      uSun: { value: preset.sunDir.clone() },
      uZenith: { value: preset.zenith.clone() },
      uHorizon: { value: preset.horizon.clone() },
      uGround: { value: preset.ground.clone() },
      uSunColor: { value: preset.sunColor.clone() },
      uHaze: { value: preset.haze },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      toneMapped: true,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.material);
    this.mesh.name = 'sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.scale.setScalar(1);   // vertex shader ignores translation anyway
  }

  /**
   * Render the sky into a pre-filtered environment map.
   * `size` trades ambient quality for memory/time — 256 is plenty for a
   * gradient sky, 128 is fine on a phone.
   */
  generateEnvironment(renderer, size = 256) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();

    const scene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.material);
    scene.add(dome);

    this.envMap?.dispose();
    this.envMap = pmrem.fromScene(scene, 0, 0.1, 100, { size }).texture;

    dome.geometry.dispose();
    pmrem.dispose();
    return this.envMap;
  }

  /** A directional light matched to the sky's own sun. */
  makeSun() {
    const p = this.preset;
    const light = new THREE.DirectionalLight(p.sunColor.clone(), p.sunIntensity);
    light.position.copy(p.sunDir).multiplyScalar(100);
    return light;
  }

  /**
   * A *token* sky/ground bounce. The environment map already supplies ambient
   * light; stacking a strong hemisphere on top of it is what flattens a PBR
   * scene into pastel. This exists only to keep the low tier (small PMREM)
   * from going murky.
   */
  makeAmbient(intensity = 0.18) {
    const p = this.preset;
    return new THREE.HemisphereLight(p.horizon.clone(), p.ground.clone(), intensity);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.envMap?.dispose();
  }
}
