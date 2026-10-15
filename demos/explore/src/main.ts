// Standalone voxel exploration demo — internal review only. Not wired into apps/*.
import * as THREE from 'three';

const $ = (id: string) => document.getElementById(id)!;

// ---------- touch-device gate ----------
const coarseOnly = matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches;
if (coarseOnly && !location.search.includes('force')) {
  $('touch-block').style.display = 'flex';
  throw new Error('touch device: demo disabled');
}

// ---------- seeded rng ----------
let seed = 1337;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------- 16x16 pixel textures ----------
function tex(base: string, noise: string[], draw?: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = base; g.fillRect(0, 0, 16, 16);
  for (let i = 0; i < 70; i++) { g.fillStyle = noise[(rnd() * noise.length) | 0]; g.fillRect((rnd() * 16) | 0, (rnd() * 16) | 0, 1, 1); }
  draw?.(g);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const T = {
  grassTop: tex('#6cbf3c', ['#5aa830', '#7fd04a', '#4f9a2a']),
  grassSide: tex('#8a5a32', ['#7a4c28', '#9a6a3c'], g => { g.fillStyle = '#6cbf3c'; g.fillRect(0, 0, 16, 4); for (let x = 0; x < 16; x++) if (rnd() < .5) g.fillRect(x, 4, 1, 1 + ((rnd() * 2) | 0)); }),
  dirt: tex('#8a5a32', ['#7a4c28', '#9a6a3c', '#6e4424']),
  log: tex('#7a5530', ['#5e3f22', '#8e6638'], g => { g.fillStyle = '#5e3f22'; for (let x = 1; x < 16; x += 4) g.fillRect(x, 0, 1, 16); }),
  leaves: tex('#3f9a3a', ['#2f7f2c', '#56b84a', '#2a6a28', '#6acc5a']),
  stone: tex('#8d8d8d', ['#777', '#a2a2a2', '#6a6a6a'], g => { g.fillStyle = '#6a6a6a'; g.fillRect(0, 7, 16, 1); g.fillRect(7, 0, 1, 7); g.fillRect(3, 8, 1, 8); }),
  plank: tex('#b07a3c', ['#9a6a32', '#c08a48'], g => { g.fillStyle = '#6e4a22'; [3, 7, 11, 15].forEach(y => g.fillRect(0, y, 16, 1)); g.fillStyle = '#444'; g.fillRect(2, 1, 1, 1); g.fillRect(13, 9, 1, 1); }),
  crate: tex('#c8964a', ['#b88540', '#d8a65a'], g => { g.strokeStyle = '#6e4a22'; g.lineWidth = 2; g.strokeRect(1, 1, 14, 14); g.beginPath(); g.moveTo(2, 2); g.lineTo(14, 14); g.stroke(); }),
  plate: tex('#9a9aa8', ['#8a8a98', '#aab'], g => { g.fillStyle = '#d33'; g.fillRect(5, 5, 6, 6); }),
  flower: tex('#6cbf3c', ['#5aa830'], g => { g.fillStyle = '#ff6fa8'; g.fillRect(3, 3, 2, 2); g.fillRect(11, 9, 2, 2); g.fillStyle = '#ffe14d'; g.fillRect(8, 12, 2, 2); }),
  chest: tex('#a8692c', ['#94591f', '#b87a3a'], g => { g.fillStyle = '#e8c040'; g.fillRect(0, 7, 16, 2); g.fillRect(7, 6, 2, 4); }),
};

// ---------- geometry with baked per-face shading (no realtime lights/shadows) ----------
const FACE_SHADE = [0.8, 0.72, 1.0, 0.5, 0.9, 0.65]; // +x -x +y -y +z -z
function shadedBox(w = 1, h = 1, d = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const col: number[] = [];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) col.push(FACE_SHADE[f], FACE_SHADE[f], FACE_SHADE[f]);
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
const mat = (map: THREE.Texture | null, color = 0xffffff, extra: any = {}) =>
  new THREE.MeshBasicMaterial({ map, color, vertexColors: true, fog: true, ...extra });

// ---------- renderer / scene / camera ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
$('app').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const SKY = 0x9fd3ff;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 14, 36);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 60);
const CAM_OFF = new THREE.Vector3(0, 15, 10.5);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// ---------- world ----------
const W = 44, D = 44;
const solid = new Set<number>();
const key = (x: number, y: number, z: number) => ((x + 64) * 256 + (y + 16)) * 256 + (z + 64);
type Kind = 'grass' | 'dirt' | 'log' | 'stone' | 'leaves' | 'flower';
const blocks: Record<Kind, number[][]> = { grass: [], dirt: [], log: [], stone: [], leaves: [], flower: [] };
function put(kind: Kind, x: number, y: number, z: number, collide = true) { blocks[kind].push([x, y, z]); if (collide) solid.add(key(x, y, z)); }

// layout constants
const GATE = { x0: 27, x1: 29, z: 18, h: 3 };
const PLATE = { x: 24, z: 22 };
const CHEST = { x: 31, y: 3, z: 7 };
const START = new THREE.Vector3(12.5, 0, 30.5);
const inPuzzle = (x: number, z: number) => x >= 21 && x <= 35 && z >= 4 && z <= 25;

for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
  put(rnd() < 0.06 ? 'flower' : 'grass', x, -1, z);
  if (x === 0 || z === 0 || x === W - 1 || z === D - 1) for (let y = 0; y < 2; y++) put('stone', x, y, z);
}
// walled puzzle yard x 22..34, z 5..18
for (let x = 22; x <= 34; x++) for (let z = 5; z <= 18; z++) {
  const edge = x === 22 || x === 34 || z === 5 || z === 18;
  if (!edge) continue;
  if (z === 18 && x >= GATE.x0 && x <= GATE.x1) continue;
  for (let y = 0; y < 5; y++) put('stone', x, y, z);
}
// jumping blocks behind the gate -> ledge
const stack = (x: number, z: number, h: number, kind: Kind = 'stone') => { for (let y = 0; y < h; y++) put(y === h - 1 && kind === 'grass' ? 'grass' : kind === 'grass' ? 'dirt' : kind, x, y, z); };
stack(28, 15, 1); stack(29, 12, 2);
for (let x = 30; x <= 33; x++) for (let z = 6; z <= 9; z++) stack(x, z, 3, 'grass');
// trees
const treeSpots: number[][] = [];
for (let i = 0; i < 60; i++) {
  const x = 2 + ((rnd() * (W - 5)) | 0), z = 2 + ((rnd() * (D - 5)) | 0);
  if (inPuzzle(x, z) || Math.hypot(x - START.x, z - START.z) < 4 || (x > 14 && x < 21 && z > 19 && z < 25)) continue;
  if (treeSpots.some(([a, b]) => Math.abs(a - x) < 3 && Math.abs(b - z) < 3)) continue;
  treeSpots.push([x, z]);
  const h = 3 + ((rnd() * 2) | 0);
  for (let y = 0; y < h; y++) put('log', x, y, z);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let y = h - 1; y <= h; y++) if (!(dx === 0 && dz === 0 && y < h)) put('leaves', x + dx, y, z + dz, false);
  put('leaves', x, h + 1, z, false);
}
// instanced meshes: one draw call per block type
const box = shadedBox();
const MATS: Record<Kind, THREE.Material | THREE.Material[]> = {
  grass: [mat(T.grassSide), mat(T.grassSide), mat(T.grassTop), mat(T.dirt), mat(T.grassSide), mat(T.grassSide)],
  flower: [mat(T.grassSide), mat(T.grassSide), mat(T.flower), mat(T.dirt), mat(T.grassSide), mat(T.grassSide)],
  dirt: mat(T.dirt), log: mat(T.log), stone: mat(T.stone), leaves: mat(T.leaves),
};
const tmpM = new THREE.Matrix4(), tmpC = new THREE.Color();
let drawCalls = 0;
(Object.keys(blocks) as Kind[]).forEach(k => {
  const list = blocks[k]; if (!list.length) return;
  const im = new THREE.InstancedMesh(box, MATS[k], list.length);
  list.forEach(([x, y, z], i) => {
    tmpM.makeTranslation(x + .5, y + .5, z + .5); im.setMatrixAt(i, tmpM);
    const v = 0.9 + rnd() * 0.12 - (y < 0 ? 0 : 0); tmpC.setRGB(v, v, v); im.setColorAt(i, tmpC);
  });
  im.frustumCulled = false; scene.add(im); drawCalls++;
});

// gate (animated, 1 instanced mesh)
const gateCells: number[][] = [];
for (let x = GATE.x0; x <= GATE.x1; x++) for (let y = 0; y < GATE.h; y++) gateCells.push([x, y, GATE.z]);
const gateMesh = new THREE.InstancedMesh(box, mat(T.plank), gateCells.length);
scene.add(gateMesh);
let gateOpen = 0, gateTriggered = false;
function updateGateMesh() {
  gateCells.forEach(([x, y, z], i) => { tmpM.makeTranslation(x + .5, y + .5 - gateOpen * 3.05, z + .5); gateMesh.setMatrixAt(i, tmpM); });
  gateMesh.instanceMatrix.needsUpdate = true;
}
updateGateMesh();
const gateSolid = (x: number, y: number, z: number) => gateOpen < 0.7 && z === GATE.z && x >= GATE.x0 && x <= GATE.x1 && y >= 0 && y < GATE.h;
const isSolid = (x: number, y: number, z: number) => solid.has(key(x, y, z)) || gateSolid(x, y, z);

// pressure plate
const plate = new THREE.Mesh(shadedBox(0.9, 0.12, 0.9), mat(T.plate));
plate.position.set(PLATE.x + .5, 0.06, PLATE.z + .5); scene.add(plate);

// ---------- blob shadow ----------
const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d')!; const gr = g.createRadialGradient(16, 16, 2, 16, 16, 16); gr.addColorStop(0, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, fog: true });
function blob(size: number) { const m = new THREE.Mesh(blobGeo, blobMat); m.scale.setScalar(size); m.renderOrder = 1; scene.add(m); return m; }
function groundBelow(x: number, y: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  for (let iy = Math.floor(y); iy > -3; iy--) if (isSolid(ix, iy, iz)) return iy + 1;
  return 0;
}

// ---------- physics bodies ----------
interface Body { pos: THREE.Vector3; vel: THREE.Vector3; hw: number; h: number; grounded: boolean; }
const EPS = 0.001;
function hitsWorld(x: number, y: number, z: number, hw: number, h: number) {
  for (let ix = Math.floor(x - hw); ix <= Math.floor(x + hw - EPS); ix++)
    for (let iy = Math.floor(y); iy <= Math.floor(y + h - EPS); iy++)
      for (let iz = Math.floor(z - hw); iz <= Math.floor(z + hw - EPS); iz++)
        if (isSolid(ix, iy, iz)) return true;
  return false;
}
const overlap = (a: Body, x: number, y: number, z: number, b: Body) =>
  Math.abs(x - b.pos.x) < a.hw + b.hw && Math.abs(z - b.pos.z) < a.hw + b.hw && y < b.pos.y + b.h && y + a.h > b.pos.y;

function moveBody(b: Body, dt: number, others: Body[], onPush?: (o: Body, axis: 'x' | 'z', d: number) => void) {
  b.vel.y -= 28 * dt; if (b.vel.y < -20) b.vel.y = -20;
  const steps = Math.ceil(Math.max(Math.abs(b.vel.x), Math.abs(b.vel.y), Math.abs(b.vel.z)) * dt / 0.2) || 1;
  const sdt = dt / steps;
  b.grounded = false;
  for (let s = 0; s < steps; s++) {
    for (const axis of ['x', 'z', 'y'] as const) {
      const d = b.vel[axis] * sdt; if (!d) continue;
      const p = b.pos.clone(); p[axis] += d;
      if (hitsWorld(p.x, p.y, p.z, b.hw, b.h)) {
        if (axis === 'y') { if (d < 0) { b.pos.y = Math.floor(p.y) + 1; b.grounded = true; } b.vel.y = 0; }
        else { b.pos[axis] = d > 0 ? Math.floor(p[axis] + b.hw) - b.hw - EPS : Math.floor(p[axis] - b.hw) + 1 + b.hw + EPS; }
        continue;
      }
      const o = others.find(o => o !== b && overlap(b, p.x, p.y, p.z, o));
      if (o) {
        if (axis === 'y') { if (d < 0) { b.pos.y = o.pos.y + o.h; b.grounded = true; } b.vel.y = 0; continue; }
        onPush?.(o, axis, d);
        if (overlap(b, p.x, p.y, p.z, o)) continue;
      }
      b.pos[axis] = p[axis];
    }
  }
  if (b.pos.y < -5) b.pos.y = 3;
}

// ---------- voxel helpers ----------
function vox(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0, parent?: THREE.Object3D, map: THREE.Texture | null = null) {
  const m = new THREE.Mesh(shadedBox(w, h, d), mat(map, color));
  m.position.set(x, y, z); parent?.add(m); return m;
}

// ---------- chick (player) ----------
const chick = new THREE.Group(); scene.add(chick);
const chickBody = new THREE.Group(); chick.add(chickBody);
const YEL = 0xffd84a;
vox(0.7, 0.5, 0.7, YEL, 0, 0.35, 0, chickBody);           // body
vox(0.6, 0.12, 0.6, YEL, 0, 0.64, 0, chickBody);          // shoulder rounding
const head = new THREE.Group(); head.position.y = 0.72; chickBody.add(head);
vox(0.56, 0.4, 0.52, YEL, 0, 0.18, 0, head);              // head (stacked boxes = rounded)
vox(0.44, 0.1, 0.42, YEL, 0, 0.43, 0, head);
vox(0.62, 0.26, 0.4, YEL, 0, 0.16, 0, head);
vox(0.04, 0.2, 0.04, 0xf2b81e, 0, 0.56, 0.02, head);      // the single hair strand
vox(0.04, 0.04, 0.12, 0xf2b81e, 0, 0.66, 0.08, head);
vox(0.08, 0.1, 0.04, 0x111111, -0.14, 0.24, 0.265, head); // eyes
vox(0.08, 0.1, 0.04, 0x111111, 0.14, 0.24, 0.265, head);
vox(0.18, 0.1, 0.16, 0xff8a1e, 0, 0.12, 0.33, head);      // beak
vox(0.1, 0.04, 0.04, 0xff9aa0, -0.24, 0.12, 0.27, head);  // cheeks
vox(0.1, 0.04, 0.04, 0xff9aa0, 0.24, 0.12, 0.27, head);
const wingL = vox(0.08, 0.3, 0.36, 0xf2c23a, -0.39, 0.38, 0, chickBody);
const wingR = vox(0.08, 0.3, 0.36, 0xf2c23a, 0.39, 0.38, 0, chickBody);
const footL = vox(0.14, 0.1, 0.2, 0xff8a1e, -0.16, 0.05, 0.04, chickBody);
const footR = vox(0.14, 0.1, 0.2, 0xff8a1e, 0.16, 0.05, 0.04, chickBody);
const chickBlob = blob(0.95);
const chickMats = [] as THREE.MeshBasicMaterial[];
chick.traverse(o => { if ((o as THREE.Mesh).isMesh) chickMats.push((o as THREE.Mesh).material as THREE.MeshBasicMaterial); });
const chickBase = chickMats.map(m => m.color.clone());

const player = { body: { pos: START.clone(), vel: new THREE.Vector3(), hw: 0.3, h: 0.95, grounded: false } as Body,
  hp: 100, maxHp: 100, face: Math.PI, dash: 0, dashCd: 0, iframes: 0, atk: 0, atkCd: 0, charging: false, charge: 0, hurt: 0, dead: 0, walk: 0, coyote: 0, jumpBuf: 0, dashDir: new THREE.Vector3() };

// ---------- push crate ----------
const crateBody: Body = { pos: new THREE.Vector3(19.5, 0, 22.5), vel: new THREE.Vector3(), hw: 0.45, h: 0.9, grounded: false };
const crate = vox(0.9, 0.9, 0.9, 0xffffff, 0, 0, 0, scene, T.crate);
const crateBlob = blob(1.1);

// ---------- monster: voxel beetle ----------
const beetle = new THREE.Group(); scene.add(beetle);
const shell = vox(0.9, 0.42, 1.0, 0x5b2d8a, 0, 0.36, 0, beetle);
vox(0.04, 0.44, 1.02, 0x2b1050, 0, 0.37, 0, beetle);
vox(0.6, 0.3, 0.3, 0x2b1a3a, 0, 0.3, 0.6, beetle);
vox(0.1, 0.1, 0.04, 0xff3030, -0.17, 0.36, 0.76, beetle); vox(0.1, 0.1, 0.04, 0xff3030, 0.17, 0.36, 0.76, beetle);
vox(0.06, 0.06, 0.3, 0x2b1a3a, -0.2, 0.3, 0.88, beetle); vox(0.06, 0.06, 0.3, 0x2b1a3a, 0.2, 0.3, 0.88, beetle);
const legs: THREE.Mesh[] = [];
for (const sx of [-1, 1]) for (const lz of [-0.3, 0, 0.3]) legs.push(vox(0.3, 0.08, 0.08, 0x1a1020, sx * 0.55, 0.12, lz, beetle));
const beetleMats: THREE.MeshBasicMaterial[] = []; beetle.traverse(o => { if ((o as THREE.Mesh).isMesh) beetleMats.push((o as THREE.Mesh).material as THREE.MeshBasicMaterial); });
const beetleBase = beetleMats.map(m => m.color.clone());
const beetleBlob = blob(1.3);
const teleGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
const telegraph = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.4, depthWrite: false }));
telegraph.visible = false; scene.add(telegraph);
const MOB_SPAWN = new THREE.Vector3(18.5, 0, 14.5);
const mob = { body: { pos: MOB_SPAWN.clone(), vel: new THREE.Vector3(), hw: 0.45, h: 0.7, grounded: false } as Body,
  hp: 60, maxHp: 60, state: 'idle' as 'idle' | 'chase' | 'windup' | 'lunge' | 'recover' | 'dead', t: 0, face: 0, dir: new THREE.Vector3(), hurt: 0, wander: new THREE.Vector3(), dead: 0, hitDone: false, kb: new THREE.Vector3() };

// ---------- chest ----------
const chest = new THREE.Group(); chest.position.set(CHEST.x + .5, CHEST.y, CHEST.z + .5); chest.rotation.y = 0; scene.add(chest);
vox(0.8, 0.5, 0.6, 0xffffff, 0, 0.25, 0, chest, T.chest);
const lid = new THREE.Group(); lid.position.set(0, 0.5, -0.3); chest.add(lid);
vox(0.82, 0.2, 0.62, 0xffffff, 0, 0.1, 0.31, lid, T.chest);
vox(0.12, 0.14, 0.04, 0xe8c040, 0, 0.0, 0.63, lid);
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 8, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
beam.position.set(0, 4, 0); chest.add(beam);
const chestState = { open: 0, opening: false, revealT: -1, rarity: '', rolls: 0 };

// ---------- attack arcs ----------
function arc(r0: number, r1: number, len: number, color: number) {
  const g = new THREE.RingGeometry(r0, r1, 18, 1, Math.PI / 2 - len / 2, len).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.visible = false; scene.add(m); return m;
}
const peckArc = arc(0.4, 1.5, 2.2, 0xfff2a0);
const heavyArc = arc(0.3, 2.4, Math.PI * 1.6, 0xffb030);
const chargeRing = arc(0.55, 0.7, Math.PI * 2, 0xffe040);
const arcs = [{ m: peckArc, t: 0, d: 0.18 }, { m: heavyArc, t: 0, d: 0.3 }];

// ---------- particles (single Points draw) ----------
const QUALITY = [
  { name: 'High', pr: Math.min(devicePixelRatio, 2), fog: [16, 40], far: 46, parts: 400 },
  { name: 'Medium', pr: 1, fog: [12, 30], far: 34, parts: 200 },
  { name: 'Low', pr: 0.7, fog: [9, 21], far: 24, parts: 70 },
];
const MAXP = 400;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 3);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, fog: true }));
points.frustumCulled = false; scene.add(points);
const parts: { p: THREE.Vector3; v: THREE.Vector3; c: THREE.Color; life: number }[] = [];
let partCap = 400;
function burst(at: THREE.Vector3, color: number, n: number, speed = 4) {
  const c = new THREE.Color(color);
  n = Math.ceil(n * partCap / 400);
  for (let i = 0; i < n && parts.length < partCap; i++)
    parts.push({ p: at.clone(), v: new THREE.Vector3((rnd() - .5) * speed, rnd() * speed, (rnd() - .5) * speed), c: c.clone().offsetHSL(0, 0, (rnd() - .5) * .2), life: 0.4 + rnd() * 0.5 });
}
function updateParts(dt: number) {
  for (let i = parts.length - 1; i >= 0; i--) { const q = parts[i]; q.life -= dt; q.v.y -= 12 * dt; q.p.addScaledVector(q.v, dt); if (q.life <= 0) parts.splice(i, 1); }
  for (let i = 0; i < MAXP; i++) {
    const q = parts[i];
    if (q) { pPos.set([q.p.x, q.p.y, q.p.z], i * 3); pCol.set([q.c.r, q.c.g, q.c.b], i * 3); } else pPos.set([0, -99, 0], i * 3);
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
  pGeo.setDrawRange(0, Math.max(parts.length, 1));
}

// ---------- floating damage numbers ----------
const dmgLayer = $('dmg-layer');
const dmgs: { el: HTMLDivElement; p: THREE.Vector3; t: number }[] = [];
function dmgText(at: THREE.Vector3, text: string, cls = '') {
  const el = document.createElement('div'); el.textContent = text; el.className = cls; dmgLayer.appendChild(el);
  dmgs.push({ el, p: at.clone().add(new THREE.Vector3((rnd() - .5) * .4, 0, 0)), t: 0 });
}
const proj = new THREE.Vector3();
function updateDmgs(dt: number) {
  for (let i = dmgs.length - 1; i >= 0; i--) {
    const d = dmgs[i]; d.t += dt; d.p.y += dt * (1.6 - d.t * 1.5);
    proj.copy(d.p).project(camera);
    d.el.style.left = ((proj.x + 1) / 2 * innerWidth) + 'px'; d.el.style.top = ((1 - proj.y) / 2 * innerHeight) + 'px';
    d.el.style.opacity = String(Math.min(1, 2.2 - d.t * 2));
    d.el.style.transform = `translate(-50%,-50%) scale(${d.t < 0.12 ? 1 + (0.12 - d.t) * 6 : 1})`;
    if (d.t > 1.1) { d.el.remove(); dmgs.splice(i, 1); }
  }
}

// ---------- input ----------
const keys = new Set<string>();
const pressed = new Set<string>();
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
});
addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyK') releaseCharge(); });
addEventListener('blur', () => keys.clear());
const down = (...c: string[]) => c.some(k => keys.has(k));

// ---------- combat ----------
let hitStop = 0, shake = 0, kQueued = false, jBuf = 0;
function hitMob(dmg: number, from: THREE.Vector3, kb: number, big: boolean) {
  if (mob.state === 'dead') return;
  mob.hp = Math.max(0, mob.hp - dmg); mob.hurt = 0.15;
  const dir = mob.body.pos.clone().sub(from).setY(0).normalize();
  mob.body.vel.x = dir.x * kb; mob.body.vel.z = dir.z * kb;
  hitStop = big ? 0.13 : 0.06; shake = big ? 0.25 : 0.1;
  const at = mob.body.pos.clone().add(new THREE.Vector3(0, 1, 0));
  dmgText(at, String(dmg) + (big ? '!' : ''), big ? 'big' : '');
  burst(at, big ? 0xffc040 : 0xffffff, big ? 30 : 12, big ? 6 : 4);
  if (mob.state === 'windup' && big) { mob.state = 'recover'; mob.t = 0.6; telegraph.visible = false; } // heavy hit interrupts
  if (mob.hp <= 0) { mob.state = 'dead'; mob.dead = 0; telegraph.visible = false; burst(at, 0x8a4ad0, 60, 7); status('Beetle defeated! (respawns in 8s)'); }
}
function hurtPlayer(dmg: number, from: THREE.Vector3) {
  if (player.iframes > 0 || player.dead > 0) return;
  player.hp = Math.max(0, player.hp - dmg); player.hurt = 0.3; player.iframes = 0.8;
  const dir = player.body.pos.clone().sub(from).setY(0).normalize();
  player.body.vel.x = dir.x * 7; player.body.vel.z = dir.z * 7; player.body.vel.y = 5;
  hitStop = 0.08; shake = 0.3;
  dmgText(player.body.pos.clone().add(new THREE.Vector3(0, 1.3, 0)), '-' + dmg, 'hurt');
  $('flash').style.opacity = '0.25'; setTimeout(() => ($('flash').style.opacity = '0'), 90);
  if (player.hp <= 0) { player.dead = 1.6; status('You fainted… respawning'); }
}
function inArc(range: number, halfAngle: number) {
  const to = mob.body.pos.clone().sub(player.body.pos); const dy = to.y; to.y = 0;
  const dist = to.length() - mob.body.hw;
  if (dist > range || Math.abs(dy) > 1.2) return false;
  const fwd = new THREE.Vector3(Math.sin(player.face), 0, Math.cos(player.face));
  return to.normalize().dot(fwd) >= Math.cos(halfAngle) || dist < 0.3;
}
function showArc(i: number, color?: number) {
  const a = arcs[i]; a.t = a.d; a.m.visible = true;
  if (color) (a.m.material as THREE.MeshBasicMaterial).color.set(color);
}
function peck() {
  if (player.atkCd > 0 || player.charging || player.dead) return;
  player.atk = 0.18; player.atkCd = 0.32; showArc(0);
  if (inArc(1.5, 1.1)) hitMob(8 + ((rnd() * 5) | 0), player.body.pos, 5, false);
}
function releaseCharge() {
  if (!player.charging) return;
  const c = player.charge; player.charging = false; player.charge = 0; chargeRing.visible = false; $('charge').style.display = 'none';
  if (c < 0.25) { peck(); return; }
  player.atk = 0.3; player.atkCd = 0.5; showArc(1);
  const dmg = Math.round(14 + 26 * Math.min(1, c));
  player.body.vel.addScaledVector(new THREE.Vector3(Math.sin(player.face), 0, Math.cos(player.face)), 6);
  if (inArc(2.4, Math.PI * 0.8)) hitMob(dmg, player.body.pos, 9 + 6 * c, true);
  else shake = 0.08;
}

// ---------- HUD ----------
let statusTimer = 0;
function status(s: string) { $('status').textContent = s; statusTimer = 3.5; }
function hud() {
  ($('hp-fill') as HTMLElement).style.width = (player.hp / player.maxHp * 100) + '%'; $('hp-text').textContent = String(player.hp);
  ($('mob-fill') as HTMLElement).style.width = (mob.hp / mob.maxHp * 100) + '%'; $('mob-text').textContent = mob.state === 'dead' ? '✝' : String(mob.hp);
}
addEventListener('keydown', e => { if (e.code === 'KeyH') $('help').style.display = $('help').style.display === 'none' ? '' : 'none'; });

// ---------- quality ----------
let qLevel = 0, autoNote = '';
function setQuality(i: number, auto = false) {
  qLevel = i; const q = QUALITY[i];
  renderer.setPixelRatio(q.pr);
  const f = scene.fog as THREE.Fog; f.near = q.fog[0]; f.far = q.fog[1];
  camera.far = q.far; camera.updateProjectionMatrix();
  partCap = q.parts; if (parts.length > partCap) parts.length = partCap;
  document.querySelectorAll('#q button').forEach((b, j) => b.classList.toggle('on', j === i));
  autoNote = auto ? `auto-downgraded to ${q.name}` : '';
  $('qnote').textContent = autoNote;
}
document.querySelectorAll<HTMLButtonElement>('#q button').forEach(b => b.addEventListener('click', () => { setQuality(+b.dataset.q!); autoOff = false; }));
addEventListener('keydown', e => { const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code); if (n >= 0) setQuality(n); });
setQuality(new URLSearchParams(location.search).has('low') ? 2 : 0);
let autoOff = false, lowFpsTime = 0, fpsVal = 60;

// ---------- rarity reveal ----------
const RAR = [{ r: 'S', w: 50, c: 0x7fd0ff }, { r: 'SS', w: 30, c: 0xc48bff }, { r: 'SSS', w: 15, c: 0xffcf3a }, { r: 'SSR', w: 5, c: 0xffffff }];
function roll() { let x = rnd() * 100; for (const r of RAR) { if ((x -= r.w) < 0) return r; } return RAR[0]; }
let forcedRarity = '';
function openChest() {
  if (chestState.opening || chestState.revealT >= 0) return;
  const r = forcedRarity ? RAR.find(q => q.r === forcedRarity)! : roll();
  chestState.opening = true; chestState.rarity = r.r; chestState.revealT = 0; chestState.rolls++;
  $('reveal').style.display = 'flex';
}
function finishReveal() {
  const r = RAR.find(q => q.r === chestState.rarity)!;
  const card = $('reveal'); card.className = 'r-' + r.r;
  const L = $('reveal-letter'); L.textContent = r.r; L.classList.remove('pop'); void L.offsetWidth; L.classList.add('pop');
  $('reveal-sub').textContent = r.r === 'SSR' ? '✨ RAINBOW SSR ✨' : 'DEMO ROLL · ' + r.r;
  burst(chest.position.clone().add(new THREE.Vector3(0, 1, 0)), r.r === 'SSR' ? 0xff60ff : r.c, 80, 7);
  const list = $('log-list'); if (chestState.rolls === 1) list.innerHTML = '';
  const row = document.createElement('div'); row.className = 'r-' + r.r; row.style.color = 'var(--c,#fff)';
  row.textContent = `#${chestState.rolls}  ${r.r}`; if (r.r === 'SSR') row.style.color = '#ff7ff0';
  list.prepend(row);
}

// ---------- test hooks (headless screenshots) ----------
(window as any).__demo = {
  player, mob, chestState, crateBody, setQuality, openChest, hitMob, peck,
  forceRarity: (r: string) => (forcedRarity = r), fps: () => fpsVal, quality: () => QUALITY[qLevel].name,
  openGate: () => (gateTriggered = true), drawCalls: () => renderer.info.render.calls, tris: () => renderer.info.render.triangles,
  disableAuto: () => (autoOff = true),
};

// ---------- main loop ----------
const clock = new THREE.Clock();
let fpsFrames = 0, fpsAcc = 0, elapsed = 0;
const camTarget = new THREE.Vector3().copy(START);
camera.position.copy(START).add(CAM_OFF); camera.lookAt(START);

function step(dt: number) {
  const P = player, B = P.body;
  // timers
  P.dashCd -= dt; P.iframes -= dt; P.atk -= dt; P.atkCd -= dt; P.hurt -= dt; P.coyote -= dt; P.jumpBuf -= dt;
  if (P.dead > 0) { P.dead -= dt; if (P.dead <= 0) respawn(); }
  if (pressed.has('KeyR')) respawn();

  // movement input (camera fixed: up = -z)
  const input = new THREE.Vector3((down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0), 0, (down('KeyS', 'ArrowDown') ? 1 : 0) - (down('KeyW', 'ArrowUp') ? 1 : 0));
  if (P.dead > 0) input.set(0, 0, 0);
  if (input.lengthSq()) input.normalize();
  const speed = P.charging ? 2.2 : 5;
  if (P.dash > 0) {
    P.dash -= dt; B.vel.x = P.dashDir.x * 15; B.vel.z = P.dashDir.z * 15;
    if (rnd() < 0.7) burst(B.pos.clone().add(new THREE.Vector3(0, .4, 0)), 0xfff6c0, 2, 1);
  } else {
    const accel = B.grounded ? 40 : 18; // smooth accel/decel
    B.vel.x += (input.x * speed - B.vel.x) * Math.min(1, accel * dt / 4);
    B.vel.z += (input.z * speed - B.vel.z) * Math.min(1, accel * dt / 4);
  }
  if (input.lengthSq() && P.atk <= 0) {
    const target = Math.atan2(input.x, input.z);
    let d = target - P.face; d = Math.atan2(Math.sin(d), Math.cos(d)); P.face += d * Math.min(1, 16 * dt);
  }
  if (B.grounded) P.coyote = 0.1;
  if (pressed.has('Space')) P.jumpBuf = 0.12;
  if (P.jumpBuf > 0 && P.coyote > 0 && !P.dead) { B.vel.y = 9.6; P.jumpBuf = 0; P.coyote = 0; burst(B.pos.clone(), 0xd8c8a0, 6, 2); }
  if (!down('Space') && B.vel.y > 3) B.vel.y -= 40 * dt; // variable jump height
  if (pressed.has('ShiftLeft') || pressed.has('ShiftRight')) {
    if (P.dashCd <= 0 && !P.dead) {
      P.dash = 0.16; P.dashCd = 0.6; P.iframes = Math.max(P.iframes, 0.3);
      P.dashDir.set(input.lengthSq() ? input.x : Math.sin(P.face), 0, input.lengthSq() ? input.z : Math.cos(P.face)).normalize();
    }
  }
  if (pressed.has('KeyJ')) jBuf = 0.2;
  jBuf -= dt; if (jBuf > 0 && P.atkCd <= 0 && !P.charging) { jBuf = 0; peck(); }
  if (pressed.has('KeyK')) kQueued = true;
  if (!keys.has('KeyK')) kQueued = false;
  if (kQueued && !P.charging && P.atkCd <= 0 && !P.dead) { P.charging = true; P.charge = 0; kQueued = false; $('charge').style.display = 'block'; }
  if (P.charging) {
    P.charge = Math.min(1.2, P.charge + dt); chargeRing.visible = true;
    chargeRing.position.set(B.pos.x, B.pos.y + 0.05, B.pos.z); chargeRing.scale.setScalar(1 + P.charge * 1.5);
    (chargeRing.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.4 * Math.sin(elapsed * 20) * (P.charge >= 1 ? 1 : 0.3);
    ($('charge-fill') as HTMLElement).style.width = Math.min(100, P.charge * 100) + '%';
    if (!keys.has('KeyK')) releaseCharge();
  }

  moveBody(B, dt, [crateBody, mob.body], (o, axis, d) => {
    if (o === crateBody) { // push crate
      const before = o.pos[axis]; o.pos[axis] += d; B.vel[axis] *= 0.92;
      if (hitsWorld(o.pos.x, o.pos.y + 0.01, o.pos.z, o.hw, o.h) || overlap(o, o.pos.x, o.pos.y, o.pos.z, mob.body)) o.pos[axis] = before;
    }
  });
  crateBody.vel.set(0, crateBody.vel.y, 0); moveBody(crateBody, dt, []);

  // monster AI
  const M = mob, MB = M.body;
  M.hurt -= dt;
  const toP = B.pos.clone().sub(MB.pos); toP.y = 0; const dist = toP.length();
  const fr = Math.pow(0.0002, dt); MB.vel.x *= fr; MB.vel.z *= fr;
  if (M.state === 'dead') {
    M.dead += dt; MB.vel.set(0, MB.vel.y, 0);
    if (M.dead > 8) { M.state = 'idle'; M.hp = M.maxHp; MB.pos.copy(MOB_SPAWN); burst(MB.pos.clone().setY(1), 0x8a4ad0, 30); }
  } else if (M.state === 'idle' || M.state === 'chase') {
    M.state = dist < 9 && !P.dead ? 'chase' : 'idle';
    let dir = M.state === 'chase' ? toP.clone().normalize() : M.wander;
    if (M.state === 'idle' && rnd() < 0.01) M.wander.set(rnd() - .5, 0, rnd() - .5).normalize().multiplyScalar(0.5);
    if (M.hurt < -0.15) { MB.vel.x = dir.x * 2.2; MB.vel.z = dir.z * 2.2; }
    if (dir.lengthSq() > 0.01) M.face = Math.atan2(dir.x, dir.z);
    if (M.state === 'chase' && dist < 2.6) { M.state = 'windup'; M.t = 0.7; M.dir.copy(toP).normalize(); M.face = Math.atan2(M.dir.x, M.dir.z); }
  } else if (M.state === 'windup') { // clear telegraph: shake, flash, red lane on ground
    M.t -= dt; MB.vel.x = 0; MB.vel.z = 0;
    M.dir.lerp(toP.clone().normalize(), dt * 2).normalize(); M.face = Math.atan2(M.dir.x, M.dir.z);
    telegraph.visible = true; telegraph.position.set(MB.pos.x, MB.pos.y + 0.03, MB.pos.z); telegraph.rotation.y = M.face;
    telegraph.scale.set(1, 1, 3.4 * (1 - M.t / 0.7) + 0.2);
    (telegraph.material as THREE.MeshBasicMaterial).opacity = 0.25 + 0.3 * (Math.sin(elapsed * 30) * .5 + .5);
    if (M.t <= 0) { M.state = 'lunge'; M.t = 0.28; M.hitDone = false; telegraph.visible = false; }
  } else if (M.state === 'lunge') {
    M.t -= dt; MB.vel.x = M.dir.x * 12; MB.vel.z = M.dir.z * 12;
    if (!M.hitDone && dist < 0.9 && Math.abs(B.pos.y - MB.pos.y) < 0.9) { M.hitDone = true; if (P.iframes <= 0) hurtPlayer(15, MB.pos); else dmgText(B.pos.clone().setY(B.pos.y + 1.3), 'DODGE'); }
    if (M.t <= 0) { M.state = 'recover'; M.t = 0.9; }
  } else if (M.state === 'recover') { M.t -= dt; if (M.t <= 0) M.state = 'idle'; }
  moveBody(MB, dt, [crateBody]);
  // contact damage outside lunge is avoided on purpose: only telegraphed attacks hurt

  // pressure plate
  const onPlate = (b: Body) => Math.abs(b.pos.x - (PLATE.x + .5)) < 0.45 + b.hw * 0.5 && Math.abs(b.pos.z - (PLATE.z + .5)) < 0.45 + b.hw * 0.5 && b.pos.y < 0.4;
  const pressedPlate = onPlate(B) || (M.state !== 'dead' && onPlate(MB)) || onPlate(crateBody);
  plate.position.y = pressedPlate ? 0.02 : 0.06;
  if (pressedPlate && !gateTriggered) { gateTriggered = true; shake = 0.2; status(onPlate(crateBody) ? 'Crate pressed the plate — gate open!' : onPlate(B) ? 'Gate open!' : 'The beetle stepped on the plate — gate open!'); }
  if (gateTriggered && gateOpen < 1) { gateOpen = Math.min(1, gateOpen + dt * 0.8); updateGateMesh(); if (rnd() < .5) burst(new THREE.Vector3(GATE.x0 + 1.5, .2, GATE.z + .5), 0x9a8a70, 2, 3); }

  // chest
  const nearChest = B.pos.distanceTo(chest.position) < 1.6;
  const hint = $('hint');
  if (nearChest && chestState.revealT < 0) { hint.style.display = 'block'; hint.textContent = chestState.rolls ? 'E: re-roll demo chest' : 'E: open chest'; }
  else hint.style.display = 'none';
  if (nearChest && pressed.has('KeyE')) openChest();
  if (chestState.revealT >= 0) {
    const t = chestState.revealT += dt;
    chestState.open = Math.min(1, t / 0.5);
    const bm = beam.material as THREE.MeshBasicMaterial;
    if (t < 1.4) { // slot-machine roll that slows down
      const idx = Math.floor(Math.pow(t, 0.6) * 14) % 4; const r = RAR[idx];
      $('reveal').className = 'r-' + r.r; $('reveal-letter').textContent = r.r; $('reveal-sub').textContent = 'ROLLING…';
      bm.color.setHex(r.c); bm.opacity = 0.3 * chestState.open;
    } else if (chestState.opening) { chestState.opening = false; finishReveal(); hitStop = 0.1; shake = 0.3; }
    else {
      const r = RAR.find(q => q.r === chestState.rarity)!;
      if (r.r === 'SSR') bm.color.setHSL((elapsed * 0.6) % 1, 1, 0.6); else bm.color.setHex(r.c);
      bm.opacity = 0.55 + 0.15 * Math.sin(elapsed * 6);
      if (rnd() < 0.3) burst(chest.position.clone().add(new THREE.Vector3(0, .8, 0)), r.r === 'SSR' ? new THREE.Color().setHSL(rnd(), 1, .6).getHex() : r.c, 1, 3);
    }
    if (t > 4.2 || (t > 1.8 && pressed.has('KeyE'))) { chestState.revealT = -1; $('reveal').style.display = 'none'; chestState.open = 0; }
  } else { (beam.material as THREE.MeshBasicMaterial).opacity *= 0.9; }
  lid.rotation.x = -1.9 * (chestState.revealT >= 0 ? Math.min(1, chestState.revealT / 0.5) : 0);
  pressed.clear();
}

function respawn() { player.body.pos.copy(START); player.body.vel.set(0, 0, 0); player.hp = player.maxHp; player.dead = 0; player.iframes = 1; }

function animate(dt: number) {
  const P = player, B = P.body;
  // chick visuals
  chick.position.copy(B.pos); chick.rotation.y = P.face;
  const moving = Math.hypot(B.vel.x, B.vel.z) > 0.5 && B.grounded;
  P.walk += dt * (moving ? 14 : 0);
  const sw = moving ? Math.sin(P.walk) : 0;
  footL.position.z = 0.04 + sw * 0.12; footR.position.z = 0.04 - sw * 0.12;
  chickBody.position.y = moving ? Math.abs(Math.sin(P.walk)) * 0.06 : Math.sin(elapsed * 2) * 0.015;
  chickBody.rotation.z = sw * 0.06;
  const flap = !B.grounded ? Math.sin(elapsed * 30) * 0.6 : 0;
  wingL.rotation.z = -flap - 0.05; wingR.rotation.z = flap + 0.05;
  // squash/stretch
  const sy = !B.grounded ? 1 + Math.min(0.12, Math.abs(B.vel.y) * 0.012) : P.charging ? 0.85 + 0.05 * Math.sin(elapsed * 30) : 1;
  chickBody.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
  head.rotation.x = P.atk > 0 ? Math.sin((1 - P.atk / 0.18) * Math.PI) * 0.7 : 0;
  const blink = P.iframes > 0 && Math.floor(elapsed * 20) % 2 === 0;
  chick.visible = !(P.dead > 0 && Math.floor(elapsed * 10) % 2 === 0);
  chickMats.forEach((m, i) => m.color.copy(P.hurt > 0 ? new THREE.Color(0xff5050) : blink ? chickBase[i].clone().multiplyScalar(1.4) : P.dash > 0 ? chickBase[i].clone().lerp(new THREE.Color(0xffffff), .5) : chickBase[i]));
  const g = groundBelow(B.pos.x, B.pos.y + 0.1, B.pos.z);
  chickBlob.position.set(B.pos.x, g + 0.02, B.pos.z); chickBlob.scale.setScalar(0.9 / (1 + (B.pos.y - g) * 0.25));
  // arcs
  for (const a of arcs) {
    if (a.t > 0) {
      a.t -= dt; const k = 1 - a.t / a.d;
      a.m.position.set(B.pos.x, B.pos.y + 0.4, B.pos.z); a.m.rotation.y = P.face - Math.PI / 2 + (k - 0.5) * 0.6;
      a.m.scale.setScalar(0.7 + k * 0.4);
      (a.m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    } else a.m.visible = false;
  }
  // crate
  crate.position.set(crateBody.pos.x, crateBody.pos.y + 0.45, crateBody.pos.z);
  crateBlob.position.set(crateBody.pos.x, groundBelow(crateBody.pos.x, crateBody.pos.y + .1, crateBody.pos.z) + 0.015, crateBody.pos.z);
  // beetle
  const M = mob, MB = M.body;
  beetle.position.copy(MB.pos); beetle.rotation.y = M.face;
  const scale = M.state === 'dead' ? Math.max(0, 1 - M.dead * 3) : M.state === 'windup' ? 1 + (0.7 - M.t) * 0.25 : 1;
  beetle.scale.set(scale, M.state === 'windup' ? scale * (0.85) : scale, scale);
  beetle.visible = scale > 0.01;
  if (M.state === 'windup') beetle.position.x += Math.sin(elapsed * 80) * 0.05;
  legs.forEach((l, i) => (l.rotation.y = Math.sin(elapsed * 18 + i) * 0.4 * (Math.hypot(MB.vel.x, MB.vel.z) > 0.3 ? 1 : 0)));
  shell.position.y = 0.36 + (M.state === 'lunge' ? 0.08 : 0);
  const flash = M.hurt > 0 ? new THREE.Color(0xffffff) : M.state === 'windup' && Math.floor(elapsed * 14) % 2 === 0 ? new THREE.Color(0xff3030) : null;
  beetleMats.forEach((m, i) => m.color.copy(flash ?? beetleBase[i]));
  beetleBlob.visible = beetle.visible; beetleBlob.position.set(MB.pos.x, groundBelow(MB.pos.x, MB.pos.y + .1, MB.pos.z) + 0.025, MB.pos.z);
  // camera follows smoothly (fixed angle, no rotation)
  camTarget.lerp(new THREE.Vector3(B.pos.x, Math.min(B.pos.y, 3) * 0.5, B.pos.z), 1 - Math.exp(-6 * dt));
  camera.position.copy(camTarget).add(CAM_OFF);
  if (shake > 0) { shake -= dt; camera.position.x += (rnd() - .5) * shake; camera.position.z += (rnd() - .5) * shake; }
  camera.lookAt(camTarget);
}

function loop() {
  requestAnimationFrame(loop);
  const raw = Math.min(clock.getDelta(), 0.05);
  elapsed += raw;
  // fps + auto downgrade
  fpsFrames++; fpsAcc += raw;
  if (fpsAcc >= 0.5) {
    fpsVal = Math.round(fpsFrames / fpsAcc); fpsFrames = 0; fpsAcc = 0;
    const el = $('fps'); el.textContent = `${fpsVal} fps · ${QUALITY[qLevel].name}`; el.style.color = fpsVal >= 55 ? '#7f7' : fpsVal >= 40 ? '#fd4' : '#f66';
    if (!autoOff && elapsed > 3) {
      lowFpsTime = fpsVal < 40 ? lowFpsTime + 0.5 : 0;
      if (lowFpsTime >= 3 && qLevel < 2) { setQuality(qLevel + 1, true); lowFpsTime = 0; }
    }
  }
  if (statusTimer > 0) { statusTimer -= raw; if (statusTimer <= 0) $('status').textContent = ''; }
  if (hitStop > 0) { hitStop -= raw; }
  else step(raw);
  animate(hitStop > 0 ? 0 : raw);
  updateParts(raw); updateDmgs(raw); hud();
  renderer.render(scene, camera);
}
status('Find the gate in the stone yard to the north-east!');
loop();
