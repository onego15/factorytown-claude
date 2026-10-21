// Scene orchestration: renderer, camera rig, lighting & day cycle, post-processing, picking and previews.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { BUILDINGS, BuildingId, ItemId } from '../sim/data';
import { BELT_Y, DX, DY, LEVEL_H } from '../sim/geom';
import { World } from '../sim/world';
import { Birds, Clouds, Villagers } from './ambient';
import { BeltView } from './beltView';
import { Hop, Particles } from './effects';
import { EntityView, materials } from './entityView';
import { getModel } from './models';
import { SEABED_Y, Vegetation, WATER_Y, buildSeabed, buildTerrainGeometry, buildWater, shared, terrainMaterial } from './terrainView';

export class CameraRig {
  target = new THREE.Vector3(0, 0.5, 0);
  goal = new THREE.Vector3(0, 0.5, 0);
  yaw = Math.PI * 0.25;
  yawGoal = Math.PI * 0.25;
  pitch = 0.9;
  pitchGoal = 0.9;
  dist = 24;
  distGoal = 24;
  bounds = 24;
  constructor(public camera: THREE.PerspectiveCamera) {}
  rotate(d: number) {
    this.yawGoal += d;
  }
  tilt(d: number) {
    this.pitchGoal = THREE.MathUtils.clamp(this.pitchGoal + d, 0.45, 1.35);
  }
  zoom(f: number) {
    this.distGoal = THREE.MathUtils.clamp(this.distGoal * f, 7, 62);
  }
  pan(dx: number, dz: number) {
    // dx/dz in screen-aligned units, scaled by distance
    const s = this.dist * 0.0016;
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    this.goal.x += (-dx * cos + dz * -sin) * s * -1;
    this.goal.z += (dx * sin + dz * -cos) * s * -1;
    this.clamp();
  }
  panWorld(dx: number, dz: number) {
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    // forward on screen = toward target from camera, projected
    const fx = -cos, fz = -sin;
    const rx = -fz, rz = fx;
    this.goal.x += rx * dx + fx * dz;
    this.goal.z += rz * dx + fz * dz;
    this.clamp();
  }
  clamp() {
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -this.bounds, this.bounds);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -this.bounds, this.bounds);
  }
  update(dt: number, groundY: number) {
    const k = 1 - Math.exp(-dt * 10);
    this.goal.y = groundY + 0.3;
    this.target.lerp(this.goal, k);
    this.yaw += (this.yawGoal - this.yaw) * k;
    this.pitch += (this.pitchGoal - this.pitch) * k;
    this.dist += (this.distGoal - this.dist) * k;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.camera.position.set(
      this.target.x + Math.cos(this.yaw) * cp * this.dist,
      this.target.y + sp * this.dist,
      this.target.z + Math.sin(this.yaw) * cp * this.dist,
    );
    this.camera.lookAt(this.target);
  }
}

const PostShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: 0.52 },
    uRange: { value: 0.28 },
    uBlur: { value: 1.0 },
    uVignette: { value: 0.32 },
    uWarm: { value: 0.0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uFocus; uniform float uRange; uniform float uBlur;
    uniform float uVignette; uniform float uWarm;
    varying vec2 vUv;
    const vec2 taps[12] = vec2[12](
      vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621),
      vec2(0.962,-0.195), vec2(0.473,-0.480), vec2(0.519,0.767), vec2(0.185,-0.893),
      vec2(0.507,0.064), vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float d = abs(vUv.y - uFocus);
      float amt = smoothstep(uRange * 0.6, uRange * 2.2, d) * uBlur;
      if (amt > 0.02) {
        vec3 acc = c.rgb;
        vec2 px = 2.6 * amt / uRes;
        for (int i = 0; i < 12; i++) acc += texture2D(tDiffuse, vUv + taps[i] * px).rgb;
        c.rgb = acc / 13.0;
      }
      // gentle grade: lift saturation, warm highlights
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(vec3(l), c.rgb, 1.1);
      c.rgb *= vec3(1.0 + uWarm * 0.06, 1.0 + uWarm * 0.02, 1.0 - uWarm * 0.04);
      vec2 v = vUv - 0.5;
      float vig = 1.0 - dot(v, v) * uVignette * 1.6;
      c.rgb *= vig;
      gl_FragColor = c;
    }`,
};

interface DayKey {
  t: number;
  sun: number;
  sunI: number;
  sky: number;
  ground: number;
  hemiI: number;
  top: number;
  horizon: number;
  fog: number;
  night: number;
}

const DAY: DayKey[] = [
  { t: 0.0, sun: 0xffb27a, sunI: 1.6, sky: 0xffd2b0, ground: 0x7a6650, hemiI: 1.0, top: 0x7fa6d6, horizon: 0xffc9a3, fog: 0xf6c7a8, night: 0.35 },
  { t: 0.1, sun: 0xfff1d8, sunI: 2.7, sky: 0xcfe6ff, ground: 0x8a7a5c, hemiI: 1.35, top: 0x6aa8e0, horizon: 0xd4ecf7, fog: 0xcfe5f0, night: 0 },
  { t: 0.45, sun: 0xfff3dc, sunI: 2.8, sky: 0xcfe6ff, ground: 0x8a7a5c, hemiI: 1.35, top: 0x5f9fdc, horizon: 0xd6eef7, fog: 0xd2e7f1, night: 0 },
  { t: 0.57, sun: 0xffa66a, sunI: 1.9, sky: 0xffc9b5, ground: 0x6a5048, hemiI: 1.05, top: 0x6f7fc0, horizon: 0xffb48f, fog: 0xf0b59a, night: 0.25 },
  { t: 0.65, sun: 0xa7b4ff, sunI: 1.0, sky: 0x6878b4, ground: 0x403c50, hemiI: 1.0, top: 0x1d2550, horizon: 0x4a5a94, fog: 0x3f4d80, night: 1 },
  { t: 0.9, sun: 0xa7b4ff, sunI: 1.0, sky: 0x6878b4, ground: 0x403c50, hemiI: 1.0, top: 0x1d2550, horizon: 0x4a5a94, fog: 0x3f4d80, night: 1 },
  { t: 1.0, sun: 0xffb27a, sunI: 1.6, sky: 0xffd2b0, ground: 0x7a6650, hemiI: 1.0, top: 0x7fa6d6, horizon: 0xffc9a3, fog: 0xf6c7a8, night: 0.35 },
];

export const DAY_LENGTH = 420; // seconds of game time per day

export class GameScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  rig: CameraRig;
  composer: EffectComposer;
  post: ShaderPass;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  world!: World;
  terrain!: THREE.Mesh;
  water!: THREE.Mesh;
  veg!: Vegetation;
  belts!: BeltView;
  ents!: EntityView;
  villagers!: Villagers;
  particles = new Particles();
  clouds = new Clouds();
  birds = new Birds();
  worldGroup = new THREE.Group();
  hops: Hop[] = [];
  dayTime = 0.12;
  time = 0;
  postEnabled = true;
  private ghost = new THREE.Group();
  private marks: THREE.InstancedMesh;
  private ring: THREE.Mesh;
  private sel = new THREE.Group();
  private selId: number | null = null;
  private smokeT = new Map<string, number>();
  private ghostMat: THREE.MeshStandardMaterial;
  private ghostKey = '';
  private raycaster = new THREE.Raycaster();

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.5, 600);
    this.rig = new CameraRig(this.camera);

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x8a7a5c, 1.3);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    this.scene.fog = new THREE.Fog(0xd2e7f1, 60, 180);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(400, 24, 12),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
        vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vP;
          void main(){ float h = normalize(vP).y; float t = smoothstep(-0.05, 0.55, h); gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0); }`,
      }),
    );
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    this.scene.add(this.worldGroup);
    this.scene.add(this.particles.points, this.clouds.group, this.birds.group);

    // preview helpers
    this.ghostMat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.72, emissive: new THREE.Color(0x30ff60), emissiveIntensity: 0.35, flatShading: true });
    const markGeo = new THREE.PlaneGeometry(0.92, 0.92);
    markGeo.rotateX(-Math.PI / 2);
    this.marks = new THREE.InstancedMesh(markGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.45, depthWrite: false }), 512);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    this.ghost.renderOrder = 3;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 64),
      new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.renderOrder = 4;
    const disk = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0xfff6d0, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.add(disk);
    this.scene.add(this.ghost, this.marks, this.ring, this.sel);

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.post = new ShaderPass(PostShader);
    this.composer.addPass(this.post);
    this.composer.addPass(new OutputPass());
  }

  setWorld(world: World) {
    this.world = world;
    this.worldGroup.clear();
    this.hops = [];
    const tm = new THREE.Mesh(buildTerrainGeometry(world), terrainMaterial());
    tm.receiveShadow = true;
    tm.castShadow = true;
    this.terrain = tm;
    this.water = buildWater(world);
    this.veg = new Vegetation(world);
    this.belts = new BeltView(world);
    this.ents = new EntityView(world);
    this.villagers = new Villagers(world);
    this.worldGroup.add(tm, buildSeabed(), this.water, this.veg.group, this.belts.group, this.ents.group, this.villagers.group);
    this.ents.sync();
    this.belts.rebuild();
    this.villagers.refreshRoads();
    const hall = world.entities.get(world.hallId);
    if (hall) {
      const c = world.center(hall);
      this.rig.goal.set(c.x - world.W / 2, 0.5, c.y - world.H / 2 + 1);
      this.rig.target.copy(this.rig.goal);
    }
    this.rig.bounds = world.W / 2;
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.post.uniforms.uRes.value.set(w * pr, h * pr);
    this.particles.setScale(h * pr, this.camera.fov);
  }

  // ---------------------------------------------------------------- world events
  onTopologyChanged(newIds: Set<number>) {
    this.ents.sync(newIds);
    this.belts.rebuild();
    this.veg.rebuild();
    this.villagers.refreshRoads();
    if (this.selId !== null) this.setSelection(this.selId);
  }

  entityWorldCenter(id: number): THREE.Vector3 | null {
    const e = this.world.entities.get(id);
    if (!e) return null;
    return new THREE.Vector3(e.x + e.w / 2 - this.world.W / 2, this.world.heightAt(e.x, e.y) * LEVEL_H, e.y + e.h / 2 - this.world.H / 2);
  }

  hop(from: number, to: number, item: ItemId) {
    const a = this.entityWorldCenter(from), b = this.entityWorldCenter(to);
    if (!a || !b) return;
    a.y += 0.3;
    b.y += 0.3;
    const d = a.distanceTo(b);
    this.hops.push({ item, from: a, to: b, t: 0, dur: 0.5 + d * 0.12, height: 0.6 + d * 0.15 });
  }

  // ---------------------------------------------------------------- per-frame
  frame(dt: number, alpha: number, running: boolean, gameDt: number) {
    this.time += dt;
    shared.time.value = this.time;
    this.dayTime = (this.dayTime + gameDt / DAY_LENGTH) % 1;
    this.applyDay();
    const groundY = this.groundHeightAt(this.rig.goal.x, this.rig.goal.z);
    this.rig.update(dt, groundY);
    // shadow camera follows the view
    const ext = THREE.MathUtils.clamp(this.rig.dist * 0.75, 10, 40);
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    if (sc.right !== ext) {
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.updateProjectionMatrix();
    }
    this.sun.target.position.copy(this.rig.target);
    // snap shadow origin to texel grid to avoid shimmering
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    this.sun.target.position.x = Math.round(this.sun.target.position.x / texel) * texel;
    this.sun.target.position.z = Math.round(this.sun.target.position.z / texel) * texel;

    (this.water.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    this.belts.extraItems.length = 0;
    // hops
    for (const h of this.hops) {
      h.t += dt / h.dur;
      const t = Math.min(1, h.t);
      const x = h.from.x + (h.to.x - h.from.x) * t;
      const z = h.from.z + (h.to.z - h.from.z) * t;
      const y = h.from.y + (h.to.y - h.from.y) * t + Math.sin(Math.PI * t) * h.height;
      this.belts.extraItems.push({ item: h.item, x, y, z, s: 0.9, ry: t * 6 });
      if (h.t >= 1) this.particles.sparkle(h.to.x, h.to.y, h.to.z, 4, [1, 0.95, 0.7]);
    }
    this.hops = this.hops.filter((h) => h.t < 1);
    this.belts.update(dt, alpha, running);
    this.ents.update(dt, running);
    this.villagers.update(dt);
    this.clouds.update(dt);
    this.birds.update(dt);
    // smoke from working buildings
    if (running) {
      for (const v of this.ents.views.values()) {
        const e = this.world.entities.get(v.id);
        if (!e || !v.smoke.length) continue;
        const active = e.status === 'working' || e.type === 'house' ? (e.type !== 'house' || e.happy) : false;
        if (!active) continue;
        v.smoke.forEach((p, i) => {
          const key = v.id + ':' + i;
          const t = (this.smokeT.get(key) ?? Math.random()) - dt;
          if (t <= 0) {
            this.particles.smoke(p.x, p.y, p.z, e.type === 'smelter' || e.type === 'mine');
            this.smokeT.set(key, e.type === 'house' ? 1.2 + Math.random() : 0.35 + Math.random() * 0.2);
          } else this.smokeT.set(key, t);
        });
      }
    }
    this.particles.update(dt);
    // selection pulse
    if (this.sel.children.length) {
      const s = 1 + Math.sin(this.time * 4) * 0.015;
      this.sel.scale.set(s, 1, s);
    }
    this.ring.rotation.z += dt * 0.2;
    if (this.postEnabled) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  private applyDay() {
    const t = this.dayTime;
    let i = 0;
    while (i < DAY.length - 2 && DAY[i + 1].t <= t) i++;
    const a = DAY[i], b = DAY[i + 1];
    const k = THREE.MathUtils.smoothstep((t - a.t) / (b.t - a.t), 0, 1);
    const lc = (x: number, y: number) => new THREE.Color(x).lerp(new THREE.Color(y), k);
    this.sun.color.copy(lc(a.sun, b.sun));
    this.sun.intensity = a.sunI + (b.sunI - a.sunI) * k;
    this.hemi.color.copy(lc(a.sky, b.sky));
    this.hemi.groundColor.copy(lc(a.ground, b.ground));
    this.hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * k;
    const sm = this.sky.material as THREE.ShaderMaterial;
    sm.uniforms.uTop.value.copy(lc(a.top, b.top));
    sm.uniforms.uHorizon.value.copy(lc(a.horizon, b.horizon));
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(lc(a.fog, b.fog));
    fog.near = this.rig.dist * 1.8;
    fog.far = this.rig.dist * 5 + 40;
    const night = a.night + (b.night - a.night) * k;
    this.ents.night = night;
    // sun path: rises east, arcs over, sets west; moon light from above at night
    const dayPhase = THREE.MathUtils.clamp(t / 0.62, 0, 1);
    const ang = night > 0.9 ? Math.PI * 0.35 : 0.25 + dayPhase * (Math.PI - 0.5);
    const elev = night > 0.9 ? 0.9 : 0.35 + Math.sin(dayPhase * Math.PI) * 0.75;
    const dir = new THREE.Vector3(Math.cos(ang), elev, Math.sin(ang) * 0.6 + 0.4).normalize();
    this.sun.position.copy(this.rig.target).addScaledVector(dir, 60);
    const wm = (this.water.material as THREE.ShaderMaterial).uniforms;
    wm.uSunDir.value.copy(dir);
    wm.uSky.value.copy(sm.uniforms.uHorizon.value);
    wm.uLight.value = 1 - night * 0.55;
    this.particles.setLight(1 - night * 0.8);
    this.clouds.material.color.setRGB(1 - night * 0.5, 1 - night * 0.5, 1 - night * 0.45);
    this.clouds.material.opacity = 0.92 - night * 0.5;
    this.post.uniforms.uWarm.value = 1 - night;
  }

  groundHeightAt(wx: number, wz: number) {
    const x = Math.floor(wx + this.world.W / 2), y = Math.floor(wz + this.world.H / 2);
    const h = this.world.heightAt(x, y);
    return Math.max(0, h) * LEVEL_H;
  }

  // ---------------------------------------------------------------- picking
  private ray(clientX: number, clientY: number) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  pickTile(clientX: number, clientY: number): { x: number; y: number } | null {
    const ray = this.ray(clientX, clientY);
    const w = this.world;
    const p = ray.origin.clone();
    const step = ray.direction.clone().multiplyScalar(0.04);
    for (let i = 0; i < 6000; i++) {
      p.add(step);
      if (p.y < SEABED_Y - 1) return null;
      const tx = Math.floor(p.x + w.W / 2), ty = Math.floor(p.z + w.H / 2);
      if (!w.inBounds(tx, ty)) {
        if (p.y < WATER_Y) return null;
        continue;
      }
      const h = w.heightAt(tx, ty);
      const top = h < 0 ? WATER_Y : h * LEVEL_H;
      if (p.y <= top) return { x: tx, y: ty };
    }
    return null;
  }

  pickEntity(clientX: number, clientY: number): number | null {
    this.ray(clientX, clientY);
    const hits = this.raycaster.intersectObjects(this.ents.pickables(), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.entityId === undefined) o = o.parent;
      if (o) return o.userData.entityId as number;
    }
    const t = this.pickTile(clientX, clientY);
    if (!t) return null;
    const e = this.world.entAt(t.x, t.y);
    return e ? e.id : null;
  }

  project(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, visible: p.z < 1 };
  }

  // ---------------------------------------------------------------- previews
  clearPreview() {
    this.ghost.clear();
    this.ghostKey = '';
    this.marks.count = 0;
    this.ring.visible = false;
  }

  private setMarks(tiles: { x: number; y: number; ok: boolean }[]) {
    const w = this.world;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    let n = 0;
    for (const t of tiles) {
      if (!w.inBounds(t.x, t.y) || n >= 512) continue;
      const h = Math.max(w.heightAt(t.x, t.y) * LEVEL_H, WATER_Y);
      m.makeTranslation(t.x + 0.5 - w.W / 2, h + 0.1, t.y + 0.5 - w.H / 2);
      this.marks.setMatrixAt(n, m);
      this.marks.setColorAt(n, c.set(t.ok ? 0x7dff9a : 0xff5a4a));
      n++;
    }
    this.marks.count = n;
    this.marks.instanceMatrix.needsUpdate = true;
    if (this.marks.instanceColor) this.marks.instanceColor.needsUpdate = true;
  }

  showBuildingGhost(type: BuildingId, x: number, y: number, rot: number, ok: boolean, badTiles: number[]) {
    const w = this.world;
    const [fw, fh] = w.footprint(type, rot);
    const key = `${type}:${rot}`;
    if (this.ghostKey !== key) {
      this.ghost.clear();
      this.ghostKey = key;
      if (type === 'road') {
        const g = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 1), this.ghostMat);
        this.ghost.add(g);
      } else {
        const m = getModel(type, 1, 0, 0, 0);
        this.ghost.add(new THREE.Mesh(m.base, this.ghostMat));
        for (const a of m.anims) {
          const o = new THREE.Mesh(a.geom, this.ghostMat);
          o.position.set(...a.pos);
          this.ghost.add(o);
        }
      }
    }
    this.ghostMat.emissive.set(ok ? 0x30ff60 : 0xff3020);
    this.ghostMat.opacity = ok ? 0.75 : 0.55;
    const h = Math.max(0, w.heightAt(x, y)) * LEVEL_H;
    this.ghost.position.set(x + fw / 2 - w.W / 2, h + 0.02, y + fh / 2 - w.H / 2);
    this.ghost.rotation.y = -rot * Math.PI * 0.5;
    const tiles: { x: number; y: number; ok: boolean }[] = [];
    const bad = new Set(badTiles);
    for (let yy = y; yy < y + fh; yy++)
      for (let xx = x; xx < x + fw; xx++) tiles.push({ x: xx, y: yy, ok: ok || (!bad.has(w.idx(xx, yy)) && badTiles.length > 0) });
    this.setMarks(tiles);
    const def = BUILDINGS[type];
    if (def.radius && (def.kind === 'gatherer' || def.kind === 'storage' || def.kind === 'hall')) {
      this.showRange(x + fw / 2, y + fh / 2, def.radius + 0.5, h);
    } else this.ring.visible = false;
  }

  showRange(cx: number, cy: number, r: number, h: number) {
    this.ring.visible = true;
    this.ring.position.set(cx - this.world.W / 2, h + 0.15, cy - this.world.H / 2);
    this.ring.scale.set(r, r, 1);
  }
  hideRange() {
    this.ring.visible = false;
  }

  showBeltPath(path: { x: number; y: number; dir: number; ok: boolean; bridge?: boolean }[], kind: 'belt' | 'road' | 'remove') {
    const w = this.world;
    this.ghost.clear();
    this.ghostKey = '';
    if (kind === 'belt') {
      const arrow = new THREE.ConeGeometry(0.16, 0.3, 3);
      arrow.rotateZ(-Math.PI / 2);
      const base = new THREE.BoxGeometry(0.96, 0.08, 0.6);
      for (const p of path) {
        const h = Math.max(0, w.heightAt(p.x, p.y)) * LEVEL_H;
        const mat = p.ok ? this.ghostMat : this.ghostMat;
        const g = new THREE.Group();
        const b = new THREE.Mesh(base, new THREE.MeshBasicMaterial({ color: !p.ok ? 0xff7a6a : p.bridge ? 0x8fd3ff : 0x9cf0a8, transparent: true, opacity: 0.55, depthWrite: false }));
        b.position.y = BELT_Y - 0.04 + (p.bridge ? 0.35 : 0);
        const a = new THREE.Mesh(arrow, new THREE.MeshBasicMaterial({ color: p.ok ? 0x1e6b33 : 0x8a1d12, transparent: true, opacity: 0.9, depthWrite: false }));
        a.position.y = BELT_Y + 0.04 + (p.bridge ? 0.35 : 0);
        a.scale.set(1, 0.4, 1);
        g.add(b, a);
        void mat;
        g.position.set(p.x + 0.5 - w.W / 2, h, p.y + 0.5 - w.H / 2);
        g.rotation.y = -p.dir * Math.PI * 0.5;
        g.renderOrder = 6;
        this.ghost.add(g);
      }
    }
    this.setMarks(path.map((p) => ({ x: p.x, y: p.y, ok: p.ok })));
    this.ring.visible = false;
  }

  setSelection(id: number | null) {
    this.selId = id;
    this.sel.clear();
    this.sel.scale.set(1, 1, 1);
    if (id === null) return;
    const e = this.world.entities.get(id);
    if (!e) {
      this.selId = null;
      return;
    }
    const w = this.world;
    const h = w.heightAt(e.x, e.y) * LEVEL_H;
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.95, depthWrite: false });
    const t = 0.06;
    const W = e.w + 0.1, D = e.h + 0.1;
    for (const [sx, sz, lx, lz] of [[0, -D / 2, W, t], [0, D / 2, W, t], [-W / 2, 0, t, D], [W / 2, 0, t, D]]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(lx, 0.05, lz), mat);
      m.position.set(sx, 0.11, sz);
      this.sel.add(m);
    }
    this.sel.position.set(e.x + e.w / 2 - w.W / 2, h, e.y + e.h / 2 - w.H / 2);
    this.sel.renderOrder = 7;
    const def = BUILDINGS[e.type];
    if (def.radius && (def.kind === 'gatherer' || def.kind === 'storage' || def.kind === 'hall')) this.showRange(e.x + e.w / 2, e.y + e.h / 2, def.radius + 0.5, h);
    else if (!this.ghost.children.length) this.ring.visible = false;
    void DX;
    void DY;
  }

  /** Render the current view to a PNG data URL (used by screenshots & tests) */
  snapshot(): string {
    return this.canvas.toDataURL('image/png');
  }
}

export { materials };
