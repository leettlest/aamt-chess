/* ============================================================
   ROYAL 3D CHESS — Three.js board × chess.js × Stockfish 19
   ============================================================ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Water } from 'three/addons/objects/Water.js';
import { Chess } from './node_modules/chess.js/dist/esm/chess.js';
import { buildWatch } from './watch.js';

/* ============================================================
   1 · CONFIG & STATE
   ============================================================ */
const SQ = 1.0;                 // one square = 1 unit
const SURF_Y = 0.06;            // board surface height
const DRAG_Y = 0.62;            // piece altitude while dragging
const FILES = 'abcdefgh';

const DIFFS = [
  { id: 'beginner', label: 'Beginner', sub: '~800',   skill: 0,  depth: 2  },
  { id: 'casual',   label: 'Casual',   sub: '~1400',  skill: 4,  depth: 4  },
  { id: 'club',     label: 'Club',     sub: '~1800',  skill: 8,  depth: 7  },
  { id: 'advanced', label: 'Advanced', sub: '~2100',  skill: 12, depth: 10 },
  { id: 'master',   label: 'Master',   sub: '~2400',  skill: 16, depth: 13 },
  { id: 'maximum',  label: 'Max',      sub: '2800+',  skill: 20, depth: 18 },
];

const game = new Chess();

const state = {
  mode: 'engine',            // 'engine' | 'local' | 'lan'
  difficulty: 'club',
  gameDifficulty: null,      // difficulty frozen at game start (for stats)
  playerColor: 'w',          // resolved color when playing vs engine
  preferredColor: 'w',       // 'w' | 'b' | 'random'
  flipped: false,
  over: false,
  selected: null,
  legalTargets: [],
  hoverSq: null,
  dragging: null,            // { piece, fromSq }
  pendingDragHit: null,      // piece detected in capture phase before OrbitControls sees pointerdown
  engineThinking: false,
  engineSearchFen: null,     // FEN of the position the current engine search was started from
  engineGen: 0,              // bumped whenever a search is invalidated (new game / undo / new request)
  engineToken: null,         // token of the active engine search
  hintToken: null,           // token of the active hint search
  blackTimer: null,          // delayed first move when playing Black
  engineReady: false,
  sound: true,
  lastMove: null,            // {from,to}
  pendingPromo: null,        // {from,to}
  winnerColor: null,         // game over: 'w' | 'b' | null
  lastAcc: null,             // cached computeAccuracies()
  evalSide: 'w',             // side to move when search started
  hintThinking: false,
  hintFen: null,
  hintArrow: null,           // Group
  bursts: [],                // particle bursts
  gen: 0,                    // analysis generation (invalidates stale evals)
  analysisQueue: [],
  analysisBusy: false,
  currentAnalysis: null,
  pendingEval: null,
  deepAnalysis: false,
  deepDone: 0,
  evalHistory: [],           // white-perspective cp per ply (mate = ±100000)
  moveTags: {},              // history index -> '!!'|'!'|'?!'|'?'|'??'
  moveTimes: [],             // {ply, color, ms} human-move timings
  turnStartedAt: Date.now(), // when current side-to-move became to-move
  recordPending: false,      // remaining positions queued to refine the written entry
  recordGen: null,           // analysis generation the pending record belongs to
  recordWritten: false,      // true once this game's entry + record counter were written
  recordTs: null,            // timestamp of the entry being refined
  lanColor: null,            // 'w' | 'b' when playing a LAN room
  lanCode: null,             // joined room code
  lanSocket: null,           // active WebSocket (/lan)
  lanConnected: false,
  lanPeer: false,            // opponent present and game started
  applyingRemote: false,     // true while applying an echoed/remote move
  lanMovePending: false,     // local move sent, waiting for the server echo
  view2d: false,             // top-down orthographic view
};

const pieces = {};            // square -> Group
const anims = [];             // running tweens
let camTween = null;

const SETTINGS_KEY = 'royal3d-settings';
const RECORD_KEY = 'royal3d-record';
const PROFILE_KEY = 'royal3d-profile';
const MAX_PROFILE_GAMES = 50;
const loadLS = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
let record = (() => {
  const r = loadLS(RECORD_KEY, {});
  const n = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return { w: n(r?.w), d: n(r?.d), l: n(r?.l) };
})();

/* ============================================================
   2 · DOM REFS
   ============================================================ */
const $ = (s) => document.querySelector(s);
const wrap = $('#board-wrap');
const canvas = $('#board-canvas');
const statusWrap = $('#status-wrap');
const statusText = $('#status-text');
const thinkingEl = $('#thinking');
const movesTableBody = $('#moves-table tbody');
const movesEmpty = $('#moves-empty');
const movesScroll = $('#moves-scroll');
const evalFill = $('#evalbar-fill');
const evalLabel = $('#evalbar-label');
const evalbar = $('#evalbar');
const footDepth = $('#foot-depth');
const footState = $('#foot-state');
const toast = $('#turntoast');
const evalGraph = $('#eval-graph');
const wpGraph = $('#wp-graph');
const matGraph = $('#material-graph');
const glabelEval = $('#glabel-eval');
const glabelWp = $('#glabel-wp');
const glabelMat = $('#glabel-mat');
const openingLine = $('#opening-line');
const predLine = $('#pred-line');
const accbarW = $('#accbar-w'), accbarB = $('#accbar-b');
const accnumW = $('#accnum-w'), accnumB = $('#accnum-b');
const qualBarW = $('#qual-bar-w'), qualBarB = $('#qual-bar-b');
const qualCountW = $('#qual-count-w'), qualCountB = $('#qual-count-b');
const mrowW = $('#mrow-w'), mrowB = $('#mrow-b');
const mNameW = $('#m-name-w'), mNameB = $('#m-name-b');
const avW = $('#avatar-w'), avB = $('#avatar-b');
const mSubW = $('#m-sub-w'), mSubB = $('#m-sub-b');
const mAccW = $('#m-acc-w'), mAccB = $('#m-acc-b');
const mCapsW = $('#m-caps-w'), mCapsB = $('#m-caps-b');
const mScoreW = $('#m-score-w'), mScoreB = $('#m-score-b');
const btnAnalyze = $('#btn-analyze');
let toastTimer = null;

/* ============================================================
   3 · SOUND (tiny WebAudio synth — zero assets)
   ============================================================ */
let actx = null;
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) {} } return actx; }
function tone(freq, dur = 0.09, type = 'sine', vol = 0.16, delay = 0) {
  if (!state.sound) return;
  const ctx = audio(); if (!ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator(), gain = ctx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
const sfx = {
  select:  () => tone(320, 0.04, 'sine', 0.06),
  move:    () => { tone(520, 0.07, 'triangle', 0.22); tone(760, 0.05, 'sine', 0.1, 0.025); },
  capture: () => { tone(210, 0.13, 'triangle', 0.3); tone(105, 0.16, 'sine', 0.26, 0.035); },
  check:   () => { tone(1046, 0.11, 'sine', 0.2); tone(1318, 0.13, 'sine', 0.16, 0.1); },
  illegal: () => tone(150, 0.08, 'square', 0.05),
  end:     () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.24, 'sine', 0.2, i * 0.16)),
  start:   () => [392, 523].forEach((f, i) => tone(f, 0.18, 'sine', 0.16, i * 0.12)),
};

/* ============================================================
   4 · THREE.JS SCENE
   ============================================================ */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.transmissionResolutionScale = 0.5; // glass refraction pass at half resolution

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9cc4e0);
scene.fog = new THREE.Fog(0xbcd6e8, 30, 90);

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 100);
camera.position.set(0, 8.8, 11.8);

/* true top-down view of the same scene — no second renderer */
const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
orthoCam.position.set(0, 22, 0.001);
function updateOrthoUp() {
  // default: White at the bottom of the screen; flip reverses it
  orthoCam.up.set(0, 0, state.flipped ? 1 : -1);
  orthoCam.lookAt(0, 0, 0);
  orthoCam.updateProjectionMatrix();
}
updateOrthoUp();
function activeCam() { return state.view2d ? orthoCam : camera; }

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 1.35);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enablePan = false;
controls.minDistance = 5.2;
controls.maxDistance = 15;
controls.minPolarAngle = 0.15;
controls.maxPolarAngle = Math.PI * 0.44;
controls.rotateSpeed = 0.7;

/* daytime sky: real photographic HDRI with clouds (CC0, Poly Haven) */
new RGBELoader().load('assets/day_sky.hdr', (hdr) => {
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  scene.backgroundIntensity = 0.9;
  scene.backgroundBlurriness = 0;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 1.0;
  pmrem.dispose();
}, undefined, (err) => console.warn('day sky HDRI failed to load:', err));

/* lights — daylight */
scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x4a5a63, 1.15));
const key = new THREE.DirectionalLight(0xfff4e2, 2.6);
key.position.set(6.5, 12, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = key.shadow.camera.bottom = -7.5;
key.shadow.camera.right = key.shadow.camera.top = 7.5;
key.shadow.camera.far = 30;
key.shadow.bias = -0.00035;
key.shadow.radius = 5;
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fc6ff, 0.7);
fill.position.set(-8, 6, -7);
scene.add(fill);

/* table — rectangular modern glass table: slab, polished edge, metal legs */
let tableGroup3D = null, tableFlat2D = null, waterSurface = null, skyCloudsGroup = null;
{
  const W = 14, D = 12;
  tableGroup3D = new THREE.Group();
  scene.add(tableGroup3D);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x39424d,
    metalness: 0.05,
    roughness: 0.06,
    transmission: 0.82,
    thickness: 0.4,
    ior: 1.5,
    attenuationColor: 0x111820,
    attenuationDistance: 3.2,
    transparent: false,
    opacity: 1,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.8,
    side: THREE.FrontSide,
  });
  const glass = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), glassMat);
  glass.position.y = -0.18;          // top face at -0.08, just under the board
  glass.receiveShadow = true;
  tableGroup3D.add(glass);

  // polished bevel along all four edges catches the room reflections
  const edgeMat = new THREE.MeshPhysicalMaterial({
    color: 0xd8e2ee, metalness: 0.15, roughness: 0.03,
    transmission: 0.35, transparent: false, opacity: 1,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.1,
  });
  const edge = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d), edgeMat);
    m.position.set(x, -0.18, z);
    tableGroup3D.add(m);
  };
  edge(W + 0.06, 0.07, 0, D / 2);
  edge(W + 0.06, 0.07, 0, -D / 2);
  edge(0.07, D, W / 2, 0);
  edge(0.07, D, -W / 2, 0);

  // underlay is visible through the glass and catches the piece shadows
  const underlay = new THREE.Mesh(
    new THREE.BoxGeometry(W - 0.1, 0.02, D - 0.1),
    new THREE.MeshStandardMaterial({ color: 0x171b21, roughness: 0.28, metalness: 0.35, envMapIntensity: 1.0 })
  );
  underlay.position.y = -0.29;
  underlay.receiveShadow = true;
  tableGroup3D.add(underlay);

  // brushed-metal legs and feet make it read as a table, not a floating slab
  const legMat = new THREE.MeshStandardMaterial({ color: 0x343a42, metalness: 0.9, roughness: 0.16, envMapIntensity: 1.0 });
  const footMat = new THREE.MeshStandardMaterial({ color: 0x1a1d21, metalness: 0.8, roughness: 0.25 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (W / 2 - 0.9), z = sz * (D / 2 - 0.9);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.6, 20), legMat);
    leg.position.set(x, -1.55, z);
    leg.castShadow = true;
    tableGroup3D.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.08, 20), footMat);
    foot.position.set(x, -2.94, z);
    foot.castShadow = true;
    tableGroup3D.add(foot);
  }

  // water surface the table stands in — reflective, gently rippling
  const waterNormals = new THREE.TextureLoader().load('assets/waternormals.jpg');
  waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;
  waterNormals.repeat.set(4, 4);
  waterSurface = new Water(new THREE.PlaneGeometry(200, 200), {
    textureWidth: 256,
    textureHeight: 256,
    waterNormals,
    sunDirection: new THREE.Vector3(0.3, 0.85, 0.2).normalize(),
    sunColor: 0xfff2d0,
    waterColor: 0x0a55a0,
    distortionScale: 2.2,
    fog: true,
  });
  waterSurface.rotation.x = -Math.PI / 2;
  waterSurface.position.y = -3.02;
  tableGroup3D.add(waterSurface);

  /* flat, glass-like tabletop for the orthographic 2D view. The physical glass
     material's screen-space refraction samples white under an ortho camera. */
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 768;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1024, 768);
  grad.addColorStop(0, '#151a20');
  grad.addColorStop(0.5, '#0b0e12');
  grad.addColorStop(1, '#181d24');
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(255,255,255,.035)';
  g.lineWidth = 36;
  for (let i = -1; i < 4; i++) {
    g.beginPath(); g.moveTo(i * 320, 0); g.lineTo(i * 320 + 260, c.height); g.stroke();
  }
  g.strokeStyle = 'rgba(216,180,106,.32)';
  g.lineWidth = 3;
  g.strokeRect(7, 7, c.width - 14, c.height - 14);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tableFlat2D = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  tableFlat2D.rotation.x = -Math.PI / 2;
  tableFlat2D.position.y = -0.085;
  tableFlat2D.visible = false;
  scene.add(tableFlat2D);
}

/* real open-source asset: CC0 mug from the Innerscene parts library */
new GLTFLoader().load('assets/mug.glb', (gltf) => {
  const mug = gltf.scene;
  mug.scale.setScalar(20); // model is in metres; one chess square is 5 cm
  const box = new THREE.Box3().setFromObject(mug);
  mug.position.set(5.4, -0.08 - box.min.y, -3.6);
  mug.rotation.y = -0.45;
  mug.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true;
    if (o.material) o.material.envMapIntensity = 1.2;
  });
  scene.add(mug);
}, undefined, (err) => console.warn('mug asset failed to load:', err));

/* drifting cloud billboards from a real CC0 cloud texture */
{
  const cloudTex = new THREE.TextureLoader().load('assets/cloud.png');
  skyCloudsGroup = new THREE.Group();
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 14; i++) {
    const mat = new THREE.SpriteMaterial({
      map: cloudTex, transparent: true, opacity: 0.28 + rand() * 0.22,
      depthWrite: false, fog: false,
    });
    const s = new THREE.Sprite(mat);
    const a = (i / 14) * Math.PI * 2 + rand() * 0.5;
    const r = 24 + rand() * 18;
    s.position.set(Math.sin(a) * r, 11 + rand() * 13, Math.cos(a) * r);
    const size = 11 + rand() * 11;
    s.scale.set(size * 1.9, size, 1);
    s.userData.drift = 0.08 + rand() * 0.15;
    skyCloudsGroup.add(s);
  }
  scene.add(skyCloudsGroup);
}

/* board squares */
const lightSqMat = new THREE.MeshStandardMaterial({ color: 0xc99a5b, roughness: 0.55, metalness: 0.02 });
const darkSqMat  = new THREE.MeshStandardMaterial({ color: 0x3a2113, roughness: 0.58, metalness: 0.02 });
const squareGeo = new THREE.BoxGeometry(SQ, 0.12, SQ);
for (let r = 0; r < 8; r++) {
  for (let f = 0; f < 8; f++) {
    const m = new THREE.Mesh(squareGeo, (r + f) % 2 === 0 ? darkSqMat : lightSqMat);
    const p = sqToWorld(FILES[f] + (r + 1));
    m.position.set(p.x, 0, p.z);
    m.receiveShadow = true;
    scene.add(m);
  }
}

/* frame */
{
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x241209, roughness: 0.4, metalness: 0.1 });
  const FRAME_W = 0.62, FRAME_H = 0.26, half = 4 + FRAME_W / 2;
  const mk = (w, d, x, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, FRAME_H, d), frameMat);
    m.position.set(x, 0.06, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  };
  mk(8 + FRAME_W * 2, FRAME_W, 0, -half);  // far
  mk(8 + FRAME_W * 2, FRAME_W, 0,  half);  // near
  mk(FRAME_W, 8, -half, 0);                // left
  mk(FRAME_W, 8,  half, 0);                // right
  // corner studs
  const studGeo = new THREE.CylinderGeometry(0.14, 0.16, 0.1, 24);
  const studMat = new THREE.MeshStandardMaterial({ color: 0xd9a94f, roughness: 0.25, metalness: 0.9 });
  for (const [sx, sz] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
    const s = new THREE.Mesh(studGeo, studMat);
    s.position.set(sx * half, 0.19, sz * half);
    s.castShadow = true;
    scene.add(s);
  }

  /* gold coordinates engraved on all four frame rails (readable from both sides) */
  const edgeText = (text) => {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 80;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 1024, 80);
    g.fillStyle = '#dca950';
    g.shadowColor = 'rgba(255,205,110,.55)';
    g.shadowBlur = 9;
    g.font = '600 42px Inter, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const chars = text.split(' ');
    for (let i = 0; i < chars.length; i++) {
      g.fillText(chars[i], (i + 0.5) * (1024 / chars.length), 44);
    }
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  };
  const addRail = (yaw, x, z, text) => {
    const holder = new THREE.Group();
    holder.position.set(x, 0.198, z);
    holder.rotation.y = yaw;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(7.7, 0.58),
      new THREE.MeshBasicMaterial({ map: edgeText(text), transparent: true, depthWrite: false })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.renderOrder = 4;
    holder.add(plane);
    scene.add(holder);
  };
  addRail(0, 0, half, 'A B C D E F G H');
  addRail(Math.PI, 0, -half, 'A B C D E F G H');
  addRail(Math.PI / 2, half, 0, '1 2 3 4 5 6 7 8');
  addRail(-Math.PI / 2, -half, 0, '1 2 3 4 5 6 7 8');
}

/* the LESTRAMK Classic lies on the table beside the board */
const { updateWatch } = buildWatch(scene);

/* coordinate plane (invisible raycast target) */
const boardPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(8, 8),
  new THREE.MeshBasicMaterial({ visible: false })
);
boardPlane.rotation.x = -Math.PI / 2;
boardPlane.position.y = SURF_Y;
scene.add(boardPlane);

/* highlight overlays */
function makeOverlay(color, opacity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.92),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = SURF_Y + 0.012;
  m.visible = false;
  m.renderOrder = 5;
  scene.add(m);
  return m;
}
const hlSelect = makeOverlay(0xffd34d, 0.5);
const hlFrom   = makeOverlay(0xffb03a, 0.38);
const hlTo     = makeOverlay(0xffb03a, 0.38);
const hlCheck  = makeOverlay(0xff3b30, 0.5);
const hlHover  = makeOverlay(0xffffff, 0.16);

/* legal-move markers */
const markersGroup = new THREE.Group();
scene.add(markersGroup);
const dotMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: false, opacity: 1 });
const ringMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: false, opacity: 1 });
const dotGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.02, 24);
const ringGeo = new THREE.TorusGeometry(0.34, 0.055, 10, 36);

function clearMarkers() {
  while (markersGroup.children.length) {
    const c = markersGroup.children.pop();
    if (c.geometry) c.geometry.dispose?.();
    markersGroup.remove(c);
  }
}

/* ============================================================
   5 · PIECE FACTORY (lathe-turned, solid + sculpted knight)
   ============================================================ */
const whitePieceMat = new THREE.MeshPhysicalMaterial({
  color: 0xf6eeda, roughness: 0.3, metalness: 0.02,
  clearcoat: 0.8, clearcoatRoughness: 0.28,
});
const blackPieceMat = new THREE.MeshPhysicalMaterial({
  color: 0x33241a, roughness: 0.22, metalness: 0.15,
  clearcoat: 0.95, clearcoatRoughness: 0.15,
});
const matFor = (color) => (color === 'w' ? whitePieceMat : blackPieceMat);

function lathe(points, mat, segments = 44) {
  const pts = points.map(([x, y]) => new THREE.Vector2(x, y));
  const geo = new THREE.LatheGeometry(pts, segments);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function sphere(radius, mat, y, widthSeg = 28, heightSeg = 20) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(radius, widthSeg, heightSeg), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}
function cyl(radius, height, mat, y, seg = 28) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, seg), mat);
  m.position.y = y;
  m.castShadow = true;
  return m;
}

function makePawn(mat) {
  const g = new THREE.Group();
  g.add(lathe([[0,0],[0.235,0],[0.265,0.035],[0.265,0.075],[0.175,0.10],[0.135,0.145],[0.125,0.26],[0.16,0.30],[0.185,0.335],[0.15,0.375],[0.09,0.395],[0,0.40]], mat));
  g.add(sphere(0.128, mat, 0.462));
  return g;
}
function makeRook(mat) {
  const g = new THREE.Group();
  g.add(lathe([[0,0],[0.255,0],[0.29,0.04],[0.29,0.08],[0.19,0.115],[0.16,0.165],[0.155,0.40],[0.215,0.44],[0.225,0.50],[0,0.50]], mat));
  // battlements
  const merlonGeo = new THREE.BoxGeometry(0.09, 0.085, 0.11);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const m = new THREE.Mesh(merlonGeo, mat);
    m.position.set(Math.sin(a) * 0.175, 0.545, Math.cos(a) * 0.175);
    m.rotation.y = a;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}
function makeKnight(mat) {
  const g = new THREE.Group();
  g.add(lathe([[0,0],[0.255,0],[0.29,0.04],[0.29,0.075],[0.185,0.11],[0.158,0.16],[0.15,0.235],[0,0.235]], mat));
  // Horse head — extruded silhouette
  const s = new THREE.Shape();
  s.moveTo(-0.165, 0);
  s.quadraticCurveTo(-0.225, 0.19, -0.14, 0.375);   // back of neck
  s.quadraticCurveTo(-0.105, 0.465, 0.005, 0.50);   // crest
  s.lineTo(0.035, 0.615);                           // ear tip
  s.lineTo(0.075, 0.50);                            // ear base
  s.quadraticCurveTo(0.135, 0.415, 0.155, 0.315);   // face
  s.quadraticCurveTo(0.27, 0.225, 0.27, 0.145);     // muzzle
  s.quadraticCurveTo(0.272, 0.085, 0.19, 0.095);    // muzzle bottom
  s.quadraticCurveTo(0.10, 0.118, 0.045, 0.095);    // jaw
  s.lineTo(0.115, 0);                               // chest
  s.closePath();
  const headGeo = new THREE.ExtrudeGeometry(s, {
    depth: 0.16, bevelEnabled: true, bevelThickness: 0.022, bevelSize: 0.022, bevelSegments: 2, steps: 1,
  });
  headGeo.translate(0, 0, -0.08);
  const head = new THREE.Mesh(headGeo, mat);
  head.position.y = 0.225;
  head.castShadow = true;
  g.add(head);
  return g;
}
function makeBishop(mat) {
  const g = new THREE.Group();
  g.add(lathe([[0,0],[0.245,0],[0.278,0.035],[0.278,0.072],[0.17,0.108],[0.128,0.155],[0.118,0.26],[0.15,0.30],[0.205,0.375],[0.21,0.45],[0.155,0.54],[0.085,0.60],[0,0.615]], mat));
  g.add(sphere(0.062, mat, 0.65));
  g.add(cyl(0.032, 0.05, mat, 0.706, 16));
  return g;
}
function makeQueen(mat) {
  const g = new THREE.Group();
  g.add(lathe([[0,0],[0.275,0],[0.31,0.04],[0.31,0.085],[0.185,0.125],[0.15,0.18],[0.14,0.42],[0.21,0.46],[0.235,0.505],[0.175,0.535],[0.155,0.6],[0.195,0.635],[0.20,0.665],[0.13,0.69],[0,0.70]], mat));
  // coronet beads
  const bead = new THREE.SphereGeometry(0.038, 14, 10);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
    const b = new THREE.Mesh(bead, mat);
    b.position.set(Math.sin(a) * 0.155, 0.72, Math.cos(a) * 0.155);
    b.castShadow = true;
    g.add(b);
  }
  g.add(sphere(0.082, mat, 0.775));
  return g;
}
function makeKing(mat) {
  const g = new THREE.Group();
  g.add(lathe([[0,0],[0.29,0],[0.325,0.04],[0.325,0.088],[0.195,0.125],[0.158,0.185],[0.148,0.50],[0.225,0.545],[0.248,0.6],[0.19,0.645],[0.175,0.71],[0,0.72]], mat));
  const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.17, 0.055), mat);
  vBar.position.y = 0.80; vBar.castShadow = true;
  const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.055, 0.055), mat);
  hBar.position.y = 0.815; hBar.castShadow = true;
  g.add(vBar, hBar);
  return g;
}
const PIECE_BUILDERS = { p: makePawn, r: makeRook, n: makeKnight, b: makeBishop, q: makeQueen, k: makeKing };

function makePiece(type, color) {
  const g = new THREE.Group();
  const body = PIECE_BUILDERS[type](matFor(color));
  g.add(body);
  if (type === 'n') g.rotation.y = color === 'w' ? Math.PI / 2 : -Math.PI / 2;
  return g;
}

/* coordinate mapping */
function sqToWorld(sq) {
  const fi = FILES.indexOf(sq[0]), ri = parseInt(sq[1], 10) - 1;
  if (!state.flipped) return { x: (fi - 3.5) * SQ, z: (3.5 - ri) * SQ };
  return { x: (3.5 - fi) * SQ, z: (ri - 3.5) * SQ };
}
function worldToSquare(x, z) {
  let fi, ri;
  if (!state.flipped) { fi = Math.round(x / SQ + 3.5); ri = Math.round(3.5 - z / SQ); }
  else { fi = Math.round(3.5 - x / SQ); ri = Math.round(z / SQ + 3.5); }
  if (fi < 0 || fi > 7 || ri < 0 || ri > 7) return null;
  return FILES[fi] + (ri + 1);
}

/* ============================================================
   6 · BOARD / PIECE SYNC
   ============================================================ */
function clearPieces() {
  for (const sq of Object.keys(pieces)) {
    scene.remove(pieces[sq]);
    delete pieces[sq];
  }
}
function spawnPiece(type, color, sq) {
  const g = makePiece(type, color);
  const p = sqToWorld(sq);
  g.position.set(p.x, SURF_Y, p.z);
  g.userData = { square: sq, type, color };
  if (type === 'n') g.rotation.y = color === 'w' ? (state.flipped ? -Math.PI / 2 : Math.PI / 2) : (state.flipped ? Math.PI / 2 : -Math.PI / 2);
  scene.add(g);
  pieces[sq] = g;
  return g;
}
function syncFromBoard() {
  clearPieces();
  const board = game.board(); // ranks 8 -> 1
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const cell = board[r][f];
      if (cell) spawnPiece(cell.type, cell.color, FILES[f] + (8 - r));
    }
  }
}
function animatePiece(g, to, opts = {}) {
  const from = g.position.clone();
  const dest = new THREE.Vector3(to.x, SURF_Y, to.z);
  anims.push({ g, from, dest, t: 0, dur: opts.dur ?? 0.24, hop: opts.hop ?? 0.42, onDone: opts.onDone });
}
function removePieceAnimated(g) {
  anims.push({ g, from: g.position.clone(), dest: g.position.clone(), t: 0, dur: 0.2, hop: 0, shrink: true });
}

/* castle rook housekeeping */
function rookCastleSquares(flags, toSquare) {
  const rank = toSquare[1];
  if (flags.includes('k')) return { from: 'h' + rank, to: 'f' + rank };
  if (flags.includes('q')) return { from: 'a' + rank, to: 'd' + rank };
  return null;
}

/* ============================================================
   7 · MARKERS & HIGHLIGHTS
   ============================================================ */
function squareCenter(sq) { const p = sqToWorld(sq); return new THREE.Vector3(p.x, SURF_Y + 0.012, p.z); }
function placeOverlay(mesh, sq, y) {
  const p = sqToWorld(sq);
  mesh.position.set(p.x, SURF_Y + (y ?? 0.012), p.z);
  mesh.visible = true;
}
function hideOverlay(mesh) { mesh.visible = false; }

function refreshOverlays() {
  // selection + legal targets
  if (state.selected) {
    placeOverlay(hlSelect, state.selected, 0.012);
  } else hideOverlay(hlSelect);
  // last move
  if (state.lastMove) {
    placeOverlay(hlFrom, state.lastMove.from, 0.011);
    placeOverlay(hlTo, state.lastMove.to, 0.011);
  } else { hideOverlay(hlFrom); hideOverlay(hlTo); }
  // check highlight
  hideOverlay(hlCheck);
  if (game.inCheck()) {
    const b = game.board();
    const turn = game.turn();
    outer:
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const c = b[r][f];
      if (c && c.type === 'k' && c.color === turn) { placeOverlay(hlCheck, FILES[f] + (8 - r), 0.013); break outer; }
    }
  }
}
function spawnMarkers() {
  clearMarkers();
  for (const mv of state.legalTargets) {
    const isCapture = mv.flags.includes('c') || mv.flags.includes('e');
    const p = squareCenter(mv.to);
    let mesh;
    if (isCapture) {
      mesh = new THREE.Mesh(ringGeo, ringMat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(p.x, SURF_Y + 0.035, p.z);
    } else {
      mesh = new THREE.Mesh(dotGeo, dotMat);
      mesh.position.set(p.x, SURF_Y + 0.02, p.z);
    }
    mesh.renderOrder = 6;
    markersGroup.add(mesh);
  }
}
function select(sq) {
  state.selected = sq;
  state.legalTargets = game.moves({ square: sq, verbose: true });
  spawnMarkers();
  refreshOverlays();
  sfx.select();
}
function deselect() {
  state.selected = null;
  state.legalTargets = [];
  clearMarkers();
  refreshOverlays();
}

/* ============================================================
   8 · INPUT (click-to-move + full 3D drag & drop)
   ============================================================ */
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAG_Y);
const planeHit = new THREE.Vector3();

function setRayFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, activeCam());
}
function pickPiece(e) {
  setRayFromEvent(e);
  const roots = Object.values(pieces);
  const hits = raycaster.intersectObjects(roots, true);
  for (const hit of hits) {
    let o = hit.object;
    while (o && !(o.userData && o.userData.square)) o = o.parent;
    if (o && o.userData.square) return o;
  }
  return null;
}
function squareFromEvent(e) {
  setRayFromEvent(e);
  if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
    return worldToSquare(planeHit.x, planeHit.z);
  }
  return null;
}
function squareFromSurface(e) {
  setRayFromEvent(e);
  const surfPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SURF_Y);
  const hit = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(surfPlane, hit)) return worldToSquare(hit.x, hit.z);
  return null;
}
function canInteract() {
  if (state.over || state.engineThinking || state.pendingPromo || state.lanMovePending) return false;
  if (state.mode === 'engine' && game.turn() !== state.playerColor) return false;
  if (state.mode === 'lan' &&
      !(state.lanConnected && state.lanPeer && game.turn() === state.lanColor)) return false;
  return true;
}
const isPromoMove = (mv) => mv.flags.includes('p');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Capture on the wrapper so OrbitControls' own canvas listener sees `enabled: false`
// when a draggable piece was grabbed — the camera must not rotate during a drag.
wrap.addEventListener('pointerdown', (e) => {
  state.pendingDragHit = null;
  if (e.target !== canvas || state.view2d || !canInteract()) return;
  const hit = pickPiece(e);
  if (hit && game.get(hit.userData.square)?.color === game.turn()) {
    state.pendingDragHit = hit;
    controls.enabled = false;
  }
}, true);

canvas.addEventListener('pointerdown', (e) => {
  audio(); // unlock synth on first gesture
  if (!canInteract()) return;
  canvas.setPointerCapture?.(e.pointerId);
  const sq = squareFromSurface(e);

  // 1) clicked a legal target for the current selection → move
  if (state.selected && sq) {
    const legal = state.legalTargets.find((m) => m.to === sq);
    if (legal) { attemptPlayerMove(legal); return; }
  }
  // 2) grabbed one of our pieces
  const hit = state.pendingDragHit || pickPiece(e);
  state.pendingDragHit = null;
  if (hit) {
    const sq2 = hit.userData.square;
    if (game.get(sq2)?.color === game.turn()) {
      if (state.selected !== sq2) select(sq2);
      state.dragging = { piece: hit, fromSq: sq2 };
      canvas.style.cursor = 'grabbing';
      return;
    }
  }
  // 3) otherwise clear selection
  deselect();
});

canvas.addEventListener('pointermove', (e) => {
  const sq = squareFromSurface(e);
  if (sq !== state.hoverSq) {
    state.hoverSq = sq;
    if (sq) placeOverlay(hlHover, sq, 0.014); else hideOverlay(hlHover);
    canvas.style.cursor = sq && pieces[sq] && game.get(sq)?.color === game.turn() && canInteract() ? 'grab' : 'default';
  }
  if (state.dragging) {
    setRayFromEvent(e);
    if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
      const half = 3.95;
      state.dragging.piece.position.set(
        THREE.MathUtils.clamp(planeHit.x, -half, half),
        DRAG_Y,
        THREE.MathUtils.clamp(planeHit.z, -half, half)
      );
    }
  }
});

canvas.addEventListener('pointerup', (e) => {
  const drag = state.dragging;
  state.dragging = null;
  state.pendingDragHit = null;
  if (!state.view2d) controls.enabled = true;
  canvas.style.cursor = 'default';
  if (!drag) return;
  if (!canInteract()) { snapBack(drag.piece, drag.fromSq); return; }
  const sq = squareFromSurface(e);
  const legal = sq ? state.legalTargets.find((m) => m.to === sq) : null;
  if (legal) attemptPlayerMove(legal);
  else snapBack(drag.piece, drag.fromSq);
});

canvas.addEventListener('pointercancel', () => {
  const drag = state.dragging;
  state.dragging = null;
  state.pendingDragHit = null;
  if (!state.view2d) controls.enabled = true;
  if (drag) snapBack(drag.piece, drag.fromSq);
});

function snapBack(piece, sq) {
  const p = sqToWorld(sq);
  animatePiece(piece, p, { dur: 0.18, hop: 0.1 });
}

/* player move entry point (handles promotion picker) */
function attemptPlayerMove(legal) {
  if (isPromoMove(legal)) {
    state.pendingPromo = { from: legal.from, to: legal.to };
    $('#promo').classList.remove('hidden');
    return;
  }
  doMove(legal.from, legal.to, undefined);
}
$('#promo-choices').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-piece]');
  if (!btn || !state.pendingPromo) return;
  const { from, to } = state.pendingPromo;
  state.pendingPromo = null;
  $('#promo').classList.add('hidden');
  doMove(from, to, btn.dataset.piece);
});

/* ============================================================
   9 · CORE MOVE EXECUTION
   ============================================================ */
function doMove(from, to, promotion) {
  // clear transient ui
  clearHintArrow();
  deselect();
  if (state.applyingRemote && state.pendingPromo) {
    state.pendingPromo = null;
    $('#promo').classList.add('hidden');
  }
  // LAN: the server is authoritative — send the intent and wait for its echo.
  // Never mutate the local board ourselves (promotion choices flow through here too).
  if (state.mode === 'lan' && !state.applyingRemote) {
    if (!lanSend({ t: 'move', from, to, promotion })) {
      showToast('LAN connection lost — move not sent');
      return false;
    }
    state.lanMovePending = true; // block a second submission until the echo arrives
    return true;
  }
  let mv;
  try {
    mv = game.move({ from, to, promotion });
  } catch (err) {
    console.warn('Illegal move rejected:', err);
    sfx.illegal();
    syncFromBoard();
    return false;
  }
  const moving = pieces[from];

  // capture?
  let capturedSq = null;
  if (mv.captured) {
    capturedSq = to;
    if (mv.flags.includes('e')) {
      const dir = mv.color === 'w' ? -1 : 1;
      capturedSq = to[0] + (parseInt(to[1], 10) + dir);
    }
  }
  const victim = capturedSq ? pieces[capturedSq] : null;
  if (victim) {
    removePieceAnimated(victim);
    if (mv.flags.includes('e') || capturedSq === to) delete pieces[capturedSq];
    else delete pieces[capturedSq];
  }

  // move piece mesh
  delete pieces[from];
  pieces[to] = moving;
  moving.userData.square = to;
  const target = sqToWorld(to);
  animatePiece(moving, target, { dur: mv.flags.includes('p') ? 0.26 : 0.22, hop: mv.piece === 'n' ? 0.55 : 0.38, onDone: () => { moving.position.y = SURF_Y; } });

  // castle → move the rook too
  const rc = rookCastleSquares(mv.flags, to);
  if (rc && pieces[rc.from]) {
    const rook = pieces[rc.from];
    delete pieces[rc.from];
    pieces[rc.to] = rook;
    rook.userData.square = rc.to;
    animatePiece(rook, sqToWorld(rc.to), { dur: 0.22, hop: 0.08 });
  }

  state.lastMove = { from, to };
  refreshOverlays();

  // promotion → swap pawn mesh for queen
  if (mv.promotion) {
    setTimeout(() => { syncFromBoard(); refreshOverlays(); }, 240);
  }

  {
    const human = state.mode === 'local' || mv.color === state.playerColor;
    const ms = Date.now() - (state.turnStartedAt || Date.now());
    if (human) state.moveTimes.push({ ply: game.history().length - 1, color: mv.color, ms });
    state.turnStartedAt = Date.now();
  }

  // audio
  if (mv.captured) sfx.capture(); else sfx.move();
  const givesCheck = game.inCheck();
  if (givesCheck) { sfx.check(); showToast('Check!'); }

  refreshUI();
  liveAnalyze();                 // queue final-position eval before any game-end recording
  const ended = checkGameEnd();
  if (!ended) maybeRequestEngine();
  return true;
}

function checkGameEnd() {
  if (state.over || !game.isGameOver()) return false;
  state.over = true;
  state.engineThinking = false;
  thinkingEl.classList.add('hidden');
  // compute once for every ending (null for draws)
  state.winnerColor = game.isCheckmate() ? (game.turn() === 'w' ? 'b' : 'w') : null;

  let title = 'Game over', sub = '', glyph = '';
  if (game.isCheckmate()) {
    const winner = state.winnerColor === 'w' ? 'White' : 'Black';
    title = 'Checkmate';
    sub = state.mode === 'engine'
      ? (winner === 'White' ? (state.playerColor === 'w' ? 'White wins — you beat FENTSTEIN-TEHN!' : 'White wins — FENTSTEIN-TEHN triumphs')
                            : (state.playerColor === 'b' ? 'Black wins — you beat FENTSTEIN-TEHN!' : 'Black wins — FENTSTEIN-TEHN triumphs'))
      : `${winner} wins`;
    glyph = '';
  } else if (game.isStalemate()) { title = 'Draw'; sub = 'Stalemate — no legal moves'; }
  else if (game.isThreefoldRepetition()) { title = 'Draw'; sub = 'Threefold repetition'; }
  else if (game.isInsufficientMaterial()) { title = 'Draw'; sub = 'Insufficient mating material'; }
  else if (game.isDraw()) { title = 'Draw'; sub = 'Fifty-move rule'; }

  $('#gameover-title').textContent = title;
  $('#gameover-sub').textContent = sub;
  $('#gameover-glyph').textContent = glyph;
  $('#gameover').classList.remove('hidden');
  sfx.end();
  if (game.isCheckmate()) spawnVictoryBurst();
  if (state.mode === 'engine') {
    // Write the result immediately; the entry is refined later if the remaining
    // positions finish analysing (see finishPendingRecord).
    if (game.isCheckmate()) {
      const winner = game.turn() === 'w' ? 'b' : 'w';
      if (winner === state.playerColor) record.w++; else record.l++;
    } else record.d++;
    try { localStorage.setItem(RECORD_KEY, JSON.stringify(record)); } catch { /* private mode */ }
    renderRecord();
    state.recordTs = Date.now();
    recordProfileEntry(state.recordTs);
    state.recordWritten = true;
    enqueueGameAnalysisForRecord();
  }
  refreshUI();
  return true;
}

/* ============================================================
   10 · STOCKFISH 19 (Web Worker, UCI)
   ============================================================ */
let engine = null;
try {
  engine = new Worker('./node_modules/stockfish/bin/stockfish-19-lite-single.js');
} catch (err) {
  console.error('Stockfish failed to load:', err);
}

const currentDiff = () => DIFFS.find((d) => d.id === state.difficulty) || DIFFS[2];

function engineSend(cmd) { try { engine?.postMessage(cmd); } catch (_) {} }

function applyDifficultyOption() {
  engineSend(`setoption name Skill Level value ${currentDiff().skill}`);
}

if (engine) {
  engine.onerror = (e) => { footState.textContent = 'engine unavailable — local play only'; console.error(e); };
  engine.onmessage = (e) => {
    const line = typeof e.data === 'string' ? e.data : String(e.data ?? '');
    handleEngineLine(line.trim());
  };
  engineSend('uci');
} else {
  footState.textContent = 'engine unavailable — local play only';
}

function handleEngineLine(line) {
  if (!line) return;
  if (line.startsWith('uciok')) {
    applyDifficultyOption();
    engineSend('isready');
    return;
  }
  if (line.startsWith('readyok')) {
    state.engineReady = true;
    if (state.mode === 'engine') footState.textContent = `fentstein-tehn · ${currentDiff().label.toLowerCase()}`;
    if (state.mode === 'engine' && state.playerColor === 'b' && !game.history().length && !state.over) {
      if (state.blackTimer) clearTimeout(state.blackTimer);
      state.blackTimer = setTimeout(() => { state.blackTimer = null; maybeRequestEngine(); }, 350);
    }
    return;
  }
  if (line.startsWith('info')) {
    const depthM = line.match(/\bdepth (\d+)/);
    if (depthM) footDepth.textContent = depthM[1];
    return;
  }
  if (line.startsWith('bestmove')) {
    const mv = line.split(/\s+/)[1];
    const wasHint = state.hintThinking;
    const token = wasHint ? state.hintToken : state.engineToken;
    if (wasHint) state.hintThinking = false;
    else state.engineThinking = false;
    // Any reply whose token is stale belongs to a search invalidated by New Game,
    // Undo, or a newer request — never apply it to the current position.
    if (token == null || token !== state.engineGen) {
      // A hint superseded by a player move must re-arm the engine search, otherwise
      // the game freezes with the player stuck on the engine's turn.
      if (wasHint && !state.over && state.mode === 'engine' && game.turn() !== state.playerColor) maybeRequestEngine();
      return;
    }
    if (!state.engineThinking) thinkingEl.classList.add('hidden');

    if (wasHint) {
      // only draw if the position is still what we asked about (user may have moved/undone)
      if (mv && mv !== '(none)' && game.fen() === state.hintFen) {
        drawHintArrow(mv.slice(0, 2), mv.slice(2, 4));
        showToast('FENTSTEIN-TEHN suggests ' + mv.slice(0, 2) + ' → ' + mv.slice(2, 4));
        sfx.select();
      }
      if (!state.over && state.mode === 'engine' && game.turn() !== state.playerColor) maybeRequestEngine();
      return;
    }
    if (state.engineSearchFen && game.fen() !== state.engineSearchFen) return;
    state.engineSearchFen = null;
    if (!mv || mv === '(none)') { if (!state.over) checkGameEnd(); return; }
    const from = mv.slice(0, 2), to = mv.slice(2, 4), promotion = mv.length > 4 ? mv[4] : undefined;
    doMove(from, to, promotion);
  }
}

function updateEvalBarFromHistory() {
  const n = game.history().length;
  const cp = state.evalHistory[n] ?? state.evalHistory[n - 1];
  if (cp == null) return;
  let pct, label;
  if (Math.abs(cp) >= 100000) {
    pct = cp > 0 ? 100 : 0;
    label = cp > 0 ? 'White mates' : 'Black mates';
  } else {
    const clamped = Math.max(-1500, Math.min(1500, cp));
    pct = 50 + 50 * Math.tanh(clamped / 420);
    label = (cp >= 0 ? '+' : '\u2212') + (Math.abs(cp) / 100).toFixed(1);
  }
  evalFill.style.height = pct.toFixed(1) + '%';
  evalLabel.textContent = label;
}

function maybeRequestEngine() {
  if (state.mode !== 'engine') return;
  if (!engine || !state.engineReady) return;
  if (game.isGameOver()) return;
  if (state.engineThinking || state.hintThinking) return;
  if (game.turn() === state.playerColor) return;
  state.engineThinking = true;
  state.evalSide = game.turn();
  state.engineSearchFen = game.fen();
  state.engineToken = ++state.engineGen;
  thinkingEl.classList.remove('hidden');
  engineSend('ucinewgame');
  engineSend('position fen ' + state.engineSearchFen);
  engineSend('go depth ' + currentDiff().depth);
}

/* ============================================================
   10.5 · ANALYTICS & PREDICTIONS (dedicated Stockfish analyzer)
   ============================================================ */
let analyzer = null;
try {
  analyzer = new Worker('./node_modules/stockfish/bin/stockfish-19-lite-single.js');
  analyzer.onmessage = (e) => handleAnalyzerLine(String(e.data).trim());
  analyzer.onerror = (err) => console.warn('analyzer worker failed:', err);
  analyzer.postMessage('uci');
} catch (err) {
  console.warn('Stockfish analyzer unavailable:', err);
}

const analyzerSend = (cmd) => { try { analyzer?.postMessage(cmd); } catch (_) {} };

function handleAnalyzerLine(line) {
  if (!line) return;
  const item = state.currentAnalysis;
  if (!item) return;
  if (line.startsWith('info')) {
    const depthM = line.match(/\bdepth (\d+)/);
    const cpM = line.match(/score cp (-?\d+)/);
    const mateM = line.match(/score mate (-?\d+)/);
    if (cpM || mateM) {
      const raw = cpM ? parseInt(cpM[1], 10) : (parseInt(mateM[1], 10) > 0 ? 100000 : -100000);
      state.pendingEval = { cp: raw, depth: depthM ? +depthM[1] : 0 };
    }
    return;
  }
  if (line.startsWith('bestmove')) {
    const result = state.pendingEval;
    state.pendingEval = null;
    state.currentAnalysis = null;
    state.analysisBusy = false;
    if (result && item.gen === state.gen) {
      const whiteCp = item.turn === 'w' ? result.cp : -result.cp;
      state.evalHistory[item.ply] = whiteCp;
      if (state.deepAnalysis) {
        state.deepDone++;
        updateAnalyzeButton();
      }
      refreshAnalytics();
    }
    pumpAnalysisQueue();
  }
}

function enqueueAnalysis(item) {
  if (!analyzer) return;
  state.analysisQueue.push(item);
  pumpAnalysisQueue();
}
function pumpAnalysisQueue() {
  if (state.analysisBusy) return;
  const item = state.analysisQueue.shift();
  if (!item) {
    if (state.deepAnalysis) finishDeepAnalysis();
    if (state.recordPending) finishPendingRecord();
    return;
  }
  if (item.gen !== state.gen) { pumpAnalysisQueue(); return; }
  state.currentAnalysis = item;
  state.analysisBusy = true;
  state.pendingEval = null;
  analyzerSend('position fen ' + item.fen);
  analyzerSend('go depth ' + item.depth);
}
function cancelQueuedAnalysis() {
  state.gen++;
  state.analysisQueue.length = 0;
  state.currentAnalysis = null;
  state.analysisBusy = false;
  if (state.deepAnalysis) {
    state.deepAnalysis = false;
    updateAnalyzeButton();
  }
}
function liveAnalyze() {
  if (!analyzer) return;
  cancelQueuedAnalysis();               // moves invalidate queued work; keep played positions' evals
  const ply = game.history().length;
  enqueueAnalysis({ gen: state.gen, ply, turn: game.turn(), fen: game.fen(), depth: 8 });
}
/* Finish a game's tracking only once the final position has been analysed, so the
   last move is not silently dropped from tags / accuracy / phase stats. */
function enqueueGameAnalysisForRecord() {
  state.recordGen = state.gen;
  state.recordPending = true;
  if (!analyzer) { finishPendingRecord(); return; }
  const scratch = new Chess();
  const positions = [{ fen: scratch.fen(), turn: 'w' }];
  for (const mv of game.history()) {
    try { scratch.move(mv); } catch { break; }
    positions.push({ fen: scratch.fen(), turn: scratch.turn() });
  }
  for (let i = 0; i < positions.length; i++) {
    if (state.evalHistory[i] != null) continue;
    enqueueAnalysis({ gen: state.gen, ply: i, turn: positions[i].turn, fen: positions[i].fen, depth: 8 });
  }
  pumpAnalysisQueue();
}
function finishPendingRecord() {
  if (!state.recordPending) return;
  state.recordPending = false;
  if (state.gen !== state.recordGen || !state.over || state.mode !== 'engine' || !game.isGameOver()) return;
  // The result was already recorded at game end; only replace the entry with a
  // fully-analysed version so the last move is included in its stats.
  computeTags();
  state.lastAcc = computeAccuracies();
  recordProfileEntry(state.recordTs);
}
function resetAnalytics() {
  cancelQueuedAnalysis();
  state.evalHistory = [];
  state.moveTags = {};
}
/* after an undo: keep still-valid evals, drop stale queue, re-evaluate the new position */
function resyncAnalysis() {
  state.gen++;
  state.analysisQueue.length = 0;
  state.currentAnalysis = null;
  state.analysisBusy = false;
  const m = game.history().length;
  state.evalHistory = state.evalHistory.slice(0, m + 1);
  if (state.deepAnalysis) {
    state.deepAnalysis = false;
    updateAnalyzeButton();
  }
  if (analyzer && state.evalHistory[m] == null) {
    enqueueAnalysis({ gen: state.gen, ply: m, turn: game.turn(), fen: game.fen(), depth: 8 });
  } else {
    refreshAnalytics();
  }
}

function toggleDeepAnalyze() {
  if (state.deepAnalysis) {
    cancelQueuedAnalysis();
    showToast('Deep analysis cancelled');
    return;
  }
  if (!analyzer) { showToast('Analysis unavailable'); return; }
  if (state.recordPending) finishPendingRecord(); // don't drop a just-finished game's refinement
  cancelQueuedAnalysis();
  state.deepAnalysis = true;
  state.deepDone = 0;
  const scratch = new Chess();
  const positions = [{ fen: scratch.fen(), turn: 'w' }];
  for (const mv of game.history()) {
    scratch.move(mv);
    positions.push({ fen: scratch.fen(), turn: scratch.turn() });
  }
  state.evalHistory.length = positions.length; // keep shape; recompute all deeply
  for (let i = 0; i < positions.length; i++) {
    enqueueAnalysis({ gen: state.gen, ply: i, turn: positions[i].turn, fen: positions[i].fen, depth: 12 });
  }
  updateAnalyzeButton();
  showToast('Deep analysis running…');
}
function finishDeepAnalysis() {
  state.deepAnalysis = false;
  updateAnalyzeButton();
  showToast('Deep analysis complete');
  refreshAnalytics();
}
function updateAnalyzeButton() {
  if (!btnAnalyze) return;
  if (state.deepAnalysis) {
    const total = game.history().length + 1;
    btnAnalyze.textContent = `Analyzing ${Math.min(state.deepDone, total)}/${total}`;
    btnAnalyze.disabled = false; // click to cancel
  } else {
    btnAnalyze.textContent = 'Analyze';
    btnAnalyze.disabled = false;
  }
}

/* ---------- opening book (prefix match on SAN sequence) ---------- */
const OPENINGS = [
  ['e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O', 'Ruy López · Closed'],
  ['e4 e5 Nf3 Nc6 Bb5 a6', 'Ruy López · Morphy Defense'],
  ['e4 e5 Nf3 Nc6 Bb5', 'Ruy López'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5 c3', 'Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 Bc4 Bc5', 'Italian Game · Giuoco Piano'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5', 'Two Knights · Fried Liver Attack'],
  ['e4 e5 Nf3 Nc6 Bc4 Nf6', 'Italian Game · Two Knights'],
  ['e4 e5 Nf3 Nc6 Bc4', 'Italian Game'],
  ['e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Nxd4 Qxd4', 'Scotch Game'],
  ['e4 e5 Nf3 Nc6 d4', 'Scotch Game'],
  ['e4 e5 Nf3 Nf6 Nxe5', "Petrov's Defense"],
  ['e4 e5 Nf3 Nf6', "Petrov's Defense"],
  ['e4 e5 Nf3 d6', "Philidor's Defense"],
  ['e4 e5 f4', "King's Gambit"],
  ['e4 e5 Qh5', 'Wayward Queen Attack'],
  ['e4 e5 Bc4', "King's Bishop Opening"],
  ['e4 e5', "King's Pawn Opening"],
  ['e4 c5 Nf3 d6', 'Sicilian Defense · Najdorf'],
  ['e4 c5 Nf3 Nc6', 'Sicilian Defense · Open'],
  ['e4 c5 Nf3 e6', 'Sicilian Defense · Scheveningen'],
  ['e4 c5 Nf3', 'Sicilian Defense · Open'],
  ['e4 c5', 'Sicilian Defense'],
  ['e4 e6 d4 d5 e5', 'French Defense · Advance'],
  ['e4 e6 d4 d5', 'French Defense'],
  ['e4 e6', 'French Defense'],
  ['e4 c6 d4 d5', 'Caro-Kann Defense'],
  ['e4 c6', 'Caro-Kann Defense'],
  ['e4 d5 exd5 Qxd5', 'Scandinavian Defense'],
  ['e4 d5', 'Scandinavian Defense'],
  ['e4 d6', 'Pirc Defense'],
  ['e4 g6', 'Modern Defense'],
  ['e4 Nf6', 'Alekhine Defense'],
  ['d4 d5 c4 e6', "Queen's Gambit Declined"],
  ['d4 d5 c4 c6', 'Slav Defense'],
  ['d4 d5 c4', "Queen's Gambit"],
  ['d4 d5', "Queen's Pawn Game"],
  ['d4 Nf6 c4 e6', "Queen's Indian Defense"],
  ['d4 Nf6 c4 g6', "King's Indian Defense"],
  ['d4 Nf6 c4', 'Indian Defense'],
  ['d4 Nf6 Nf3', 'Torre Attack'],
  ['d4 Nf6', 'Indian Defense'],
  ['d4 d6', 'Old Indian Defense'],
  ['d4 f5', 'Dutch Defense'],
  ['d4 g6', 'Modern Defense'],
  ['c4', 'English Opening'],
  ['Nf3', 'Réti Opening'],
  ['g3', 'Fianchetto Opening'],
  ['f4', 'Bird Opening'],
  ['b3', 'Nimzo-Larsen Opening'],
];
function openingName(sans) {
  const seq = sans.join(' ');
  let best = null;
  for (const [key, name] of OPENINGS) {
    if (seq === key || seq.startsWith(key + ' ')) {
      if (!best || key.length > best[0].length) best = [key, name];
    }
  }
  return best ? best[1] : sans.length ? 'Unorthodox / Offbeat Play' : null;
}

/* ---------- derived analytics ---------- */
function computeTags() {
  const hist = game.history({ verbose: true });
  state.moveTags = {};
  let tagged = 0;
  for (let i = 1; i <= hist.length; i++) {
    const before = state.evalHistory[i - 1], after = state.evalHistory[i];
    if (before == null || after == null) continue;
    const sign = hist[i - 1].color === 'w' ? 1 : -1;
    const loss = sign * (before - after); // cp lost by the mover (positive = bad)
    if (loss > 10000) continue; // mate swing — no meaningful tag
    let tag = null;
    if (loss >= 300) tag = '??';
    else if (loss >= 150) tag = '?';
    else if (loss >= 80) tag = '?!';
    else if (loss <= -80) tag = '!';
    state.moveTags[i - 1] = tag;
    tagged++;
  }
  return tagged;
}
function computeAccuracies() {
  const hist = game.history({ verbose: true });
  const acc = { w: [], b: [] };
  const mis = { w: 0, b: 0 };
  for (let i = 1; i <= hist.length; i++) {
    const before = state.evalHistory[i - 1], after = state.evalHistory[i];
    if (before == null || after == null) continue;
    const mover = hist[i - 1].color;
    const sign = mover === 'w' ? 1 : -1;
    const swing = sign * (before - after);
    if (swing > 10000) continue; // mate swing — not a usable accuracy sample
    const loss = Math.max(0, swing); // cp lost
    acc[mover].push(100 * Math.exp(-0.0008 * loss));
    const tag = state.moveTags[i - 1];
    if (tag === '?' || tag === '??') mis[mover]++;
  }
  const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  return { wAcc: avg(acc.w), bAcc: avg(acc.b), wMis: mis.w, bMis: mis.b, tagged: acc.w.length + acc.b.length, wPairs: acc.w.length, bPairs: acc.b.length };
}

/* generic canvas line plot with zero line + optional gridlines */
function plotSeries(canvas, values, opts) {
  if (!canvas) return;
  const { ymin, ymax, grid = [], zero = true, line = '#ffd873', glow = 'rgba(255,200,90,.6)', placeholder = 'no data yet' } = opts;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const n = game.history().length;
  const xFor = (i) => (n === 0 ? w / 2 : 12 + (i / n) * (w - 24));
  const yFor = (v) => h - 7 - ((v - ymin) / (ymax - ymin)) * (h - 14);

  for (const g of grid) {
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, yFor(g)); ctx.lineTo(w, yFor(g)); ctx.stroke();
  }
  if (zero) {
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, yFor(0)); ctx.lineTo(w, yFor(0)); ctx.stroke();
    ctx.setLineDash([]);
  }

  const pts = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    pts.push([xFor(i), yFor(Math.max(ymin, Math.min(ymax, v)))]);
  }
  if (pts.length >= 2) {
    const baseY = zero ? yFor(0) : h - 6;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], baseY);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(pts[pts.length - 1][0], baseY);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, line + '4d');
    grad.addColorStop(1, line + '0a');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.shadowColor = glow;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;
    const [lx, ly] = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(lx, ly, 3, 0, Math.PI * 2); ctx.fillStyle = line; ctx.fill();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(placeholder, w / 2, h / 2 + 3);
  }
}

/* material swing per ply, in pawns (promotions add +8 to the mover) */
const MAT_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
function computeMaterialHistory() {
  const hist = game.history({ verbose: true });
  const arr = [0];
  let diff = 0;
  for (const mv of hist) {
    if (mv.captured) diff += (mv.color === 'w' ? 1 : -1) * (MAT_VALUE[mv.captured] || 0);
    if (mv.promotion) diff += (mv.color === 'w' ? 1 : -1) * 8;
    arr.push(diff);
  }
  return arr;
}
const cpToPawns = (v) => (Math.abs(v) >= 100000 ? Math.sign(v) * 7 : v / 100);
const wpOf = (cp) => 1 / (1 + Math.exp(-cp / 290));
const evalPawnLabel = (cp) => Math.abs(cp) >= 100000
  ? (cp > 0 ? 'M (W)' : 'M (B)')
  : ((cp >= 0 ? '+' : '\u2212') + (Math.abs(cp) / 100).toFixed(1));

function drawEvalGraph() {
  const values = [];
  for (let i = 0; i < state.evalHistory.length; i++) {
    const v = state.evalHistory[i];
    values[i] = v == null ? null : Math.max(-6.5, Math.min(6.5, cpToPawns(v)));
  }
  plotSeries(evalGraph, values, { ymin: -6.5, ymax: 6.5, grid: [3.25, -3.25], zero: true, line: '#ffd873', glow: 'rgba(255,200,90,.6)', placeholder: 'evaluation over time' });
}
function drawWpGraph() {
  const values = [];
  for (let i = 0; i < state.evalHistory.length; i++) {
    const v = state.evalHistory[i];
    values[i] = v == null ? null : wpOf(Math.abs(v) >= 100000 ? Math.sign(v) * 100000 : v) * 100;
  }
  plotSeries(wpGraph, values, { ymin: 0, ymax: 100, grid: [25, 50, 75], zero: false, line: '#8be0a4', glow: 'rgba(90,220,140,.5)', placeholder: 'win probability over time' });
}
function drawMaterialGraph() {
  plotSeries(matGraph, computeMaterialHistory(), { ymin: -12, ymax: 12, grid: [6, -6], zero: true, line: '#8ec5ff', glow: 'rgba(110,180,255,.5)', placeholder: 'material swing over time' });
}

function updateGraphLabels(cp) {
  if (glabelEval) glabelEval.textContent = cp == null ? '\u2013' : evalPawnLabel(cp);
  if (glabelWp) glabelWp.textContent = cp == null ? '\u2013' : Math.round(wpOf(cp) * 100) + '%';
  if (glabelMat) {
    const d = computeMaterialHistory();
    const m = d[d.length - 1] || 0;
    glabelMat.textContent = (m >= 0 ? '+' : '\u2212') + Math.abs(m);
  }
}

function updateWpPrediction() {
  if (!predLine) return;
  const n = game.history().length;
  const cp = state.evalHistory[n] ?? state.evalHistory[n - 1];
  if (cp == null) {
    predLine.innerHTML = 'Prediction · <b>analyzing…</b>';
    return;
  }
  const eff = Math.abs(cp) >= 100000 ? Math.sign(cp) * 100000 : cp;
  const pct = Math.round(wpOf(eff) * 100);
  let verdict;
  if (pct >= 70) verdict = 'White is winning';
  else if (pct >= 58) verdict = 'White is better';
  else if (pct >= 45) verdict = 'Dead equal';
  else if (pct >= 30) verdict = 'Black is better';
  else verdict = 'Black is winning';
  predLine.innerHTML = `Prediction · <b>${verdict}</b> · White ${pct}%`;
}

function updateOpeningLine() {
  if (!openingLine) return;
  const name = openingName(game.history());
  openingLine.innerHTML = name
    ? `<span>Opening</span> · ${name}`
    : '<span>Opening</span> · awaiting first moves…';
}

function updateAccBars() {
  state.lastAcc = computeAccuracies();
  const { wAcc, bAcc } = state.lastAcc;
  const setBar = (fillEl, numEl, val) => {
    if (val == null) { fillEl.style.width = '0%'; numEl.textContent = '–'; numEl.className = 'acc-num'; return; }
    fillEl.style.width = Math.max(2, val).toFixed(1) + '%';
    numEl.textContent = Math.round(val) + '%';
    numEl.className = 'acc-num ' + (val >= 75 ? 'good' : val < 55 ? 'hot' : '');
  };
  setBar(accbarW, accnumW, wAcc);
  setBar(accbarB, accnumB, bAcc);
}

function updateQualityBlock() {
  const hist = game.history({ verbose: true });
  const counts = { w: { good: 0, inacc: 0, mistake: 0, blunder: 0 }, b: { good: 0, inacc: 0, mistake: 0, blunder: 0 } };
  const moves = { w: 0, b: 0 };
  for (let i = 0; i < hist.length; i++) {
    const side = hist[i].color;
    moves[side]++;
    const tag = state.moveTags[i];
    if (tag === '!') counts[side].good++;
    else if (tag === '?!') counts[side].inacc++;
    else if (tag === '?') counts[side].mistake++;
    else if (tag === '??') counts[side].blunder++;
  }
  const render = (barEl, countEl, side) => {
    if (!barEl || !countEl) return;
    const c = counts[side];
    const tagged = c.good + c.inacc + c.mistake + c.blunder;
    const pairs = state.lastAcc ? (side === 'w' ? state.lastAcc.wPairs : state.lastAcc.bPairs) : 0;
    countEl.textContent = moves[side] + ' mv' + (c.blunder ? ` · ${c.blunder}??` : '');
    if (tagged === 0) {
      barEl.innerHTML = pairs > 0
        ? '<div class="seg-good" style="width:100%" title="Clean — no inaccuracies yet"></div>'
        : '<span class="qual-empty">awaiting evals</span>';
      return;
    }
    const pct = (v) => ((v / tagged) * 100).toFixed(1) + '%';
    barEl.innerHTML =
      (c.good ? `<div class="seg-good" style="width:${pct(c.good)}" title="Good (!) ${c.good}"></div>` : '') +
      (c.inacc ? `<div class="seg-inacc" style="width:${pct(c.inacc)}" title="Inaccuracy (?!) ${c.inacc}"></div>` : '') +
      (c.mistake ? `<div class="seg-mistake" style="width:${pct(c.mistake)}" title="Mistake (?) ${c.mistake}"></div>` : '') +
      (c.blunder ? `<div class="seg-blunder" style="width:${pct(c.blunder)}" title="Blunder (??) ${c.blunder}"></div>` : '');
  };
  render(qualBarW, qualCountW, 'w');
  render(qualBarB, qualCountB, 'b');
}

function refreshMatchup() {
  if (!mrowW) return;
  const turn = game.turn();
  const over = state.over;
  const isEngine = state.mode === 'engine';
  const isLan = state.mode === 'lan';
  const pCol = isLan ? state.lanColor : state.playerColor;
  const nameFor = (side) => {
    if (isLan) return side === pCol && pCol ? 'You' : (side === 'w' ? 'White' : 'Black');
    if (!isEngine) return side === 'w' ? 'White Player' : 'Black Player';
    return side === pCol ? 'You' : 'FENTSTEIN-TEHN';
  };
  const subFor = (side) => {
    const color = side === 'w' ? 'White' : 'Black';
    if (isLan) return color + (side === pCol && pCol ? ' · You (LAN)' : ' · Opponent (LAN)');
    if (!isEngine) return color + ' · Local';
    return color + (side === pCol ? ' · You' : ' · FENTSTEIN-TEHN') + ' · ' + currentDiff().label;
  };
  const avatarFor = (side) => (isEngine && side !== pCol ? 'assets/fentstein.jpg' : 'assets/userr.jpg');
  if (avW) { avW.src = avatarFor('w'); avW.alt = isEngine && pCol !== 'w' ? 'FENTSTEIN-TEHN' : 'User'; }
  if (avB) { avB.src = avatarFor('b'); avB.alt = isEngine && pCol !== 'b' ? 'FENTSTEIN-TEHN' : 'User'; }
  mNameW.textContent = nameFor('w');
  mSubW.textContent = subFor('w');
  mNameB.textContent = nameFor('b');
  mSubB.textContent = subFor('b');

  mrowW.classList.toggle('active', !over && turn === 'w');
  mrowB.classList.toggle('active', !over && turn === 'b');
  mrowW.classList.toggle('winner', over && state.winnerColor === 'w');
  mrowB.classList.toggle('winner', over && state.winnerColor === 'b');
  mrowW.classList.toggle('dim', over && state.winnerColor === 'b');
  mrowB.classList.toggle('dim', over && state.winnerColor === 'w');

  const acc = state.lastAcc || computeAccuracies();
  const setAcc = (el, v) => {
    if (v == null) { el.textContent = '–'; el.className = ''; return; }
    el.textContent = Math.round(v);
    el.className = v >= 75 ? 'good' : v < 55 ? 'hot' : '';
  };
  setAcc(mAccW, acc.wAcc);
  setAcc(mAccB, acc.bAcc);

  const verbose = game.history({ verbose: true });
  const capturedBy = { w: [], b: [] };
  for (const mv of verbose) if (mv.captured) capturedBy[mv.color].push(mv.captured);
  const sortDesc = (arr) => arr.slice().sort((a, b) => (MAT_VALUE[b] || 0) - (MAT_VALUE[a] || 0));
  mCapsW.textContent = sortDesc(capturedBy.w).map((t) => GLYPH[t]).join('');
  mCapsB.textContent = sortDesc(capturedBy.b).map((t) => GLYPH[t]).join('');
  const matW = capturedBy.w.reduce((s, t) => s + (MAT_VALUE[t] || 0), 0);
  const matB = capturedBy.b.reduce((s, t) => s + (MAT_VALUE[t] || 0), 0);
  const diff = matW - matB;
  mScoreW.textContent = diff > 0 ? '+' + diff : '';
  mScoreB.textContent = diff < 0 ? '+' + (-diff) : '';
}

function refreshAnalytics() {
  computeTags();
  state.lastAcc = computeAccuracies();
  drawEvalGraph();
  drawWpGraph();
  drawMaterialGraph();
  const n = game.history().length;
  const cp = state.evalHistory[n] ?? state.evalHistory[n - 1];
  updateGraphLabels(cp ?? null);
  updateWpPrediction();
  updateOpeningLine();
  updateAccBars();
  updateQualityBlock();
  updateEvalBarFromHistory();
  refreshMatchup();
  renderMoves();
}

/* ============================================================
   11 · UI REFRESH
   ============================================================ */
const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
const TAG_CLASS = { '!!': 'q-great', '!': 'q-good', '?!': 'q-inaccuracy', '?': 'q-mistake', '??': 'q-blunder' };

function renderMoves() {
  const hist = game.history();
  movesTableBody.innerHTML = '';
  movesEmpty.style.display = hist.length ? 'none' : 'block';
  for (let i = 0; i < hist.length; i += 2) {
    const tr = document.createElement('tr');
    const num = document.createElement('td'); num.className = 'num'; num.textContent = (i / 2 + 1) + '.';
    const wCell = document.createElement('td'); wCell.className = 'mv';
    const bCell = document.createElement('td'); bCell.className = 'mv';
    wCell.innerHTML = hist[i] ?? '';
    bCell.innerHTML = hist[i + 1] ?? '';
    const wTag = state.moveTags[i];
    const bTag = state.moveTags[i + 1];
    if (wTag) wCell.innerHTML += `<span class="qtag ${TAG_CLASS[wTag]}">${wTag}</span>`;
    if (bTag) bCell.innerHTML += `<span class="qtag ${TAG_CLASS[bTag]}">${bTag}</span>`;
    if (i === hist.length - 1) wCell.classList.add('last');
    if (i + 1 === hist.length - 1) bCell.classList.add('last');
    tr.append(num, wCell, bCell);
    movesTableBody.appendChild(tr);
  }
  movesScroll.scrollTop = movesScroll.scrollHeight;
}

function refreshUI() {
  // status
  const turn = game.turn();
  if (state.over) {
    statusText.textContent = game.isCheckmate() ? 'Checkmate' : 'Draw';
  } else {
    const side = turn === 'w' ? 'White' : 'Black';
    statusText.textContent = game.inCheck() ? `${side} to move — check!` : `${side} to move`;
  }
  statusWrap.classList.toggle('black-turn', turn === 'b');
  statusWrap.classList.toggle('check', !state.over && game.inCheck());

  // moves list (with quality tags)
  renderMoves();

  // matchup header (turn glow, accuracy, captures, material)
  refreshMatchup();

  // engine opts visibility
  $('#engine-opts').style.display = state.mode === 'engine' ? 'block' : 'none';
  evalbar.style.opacity = state.mode === 'engine' ? '1' : '0.85';

  updateOpeningLine();
  drawEvalGraph();
  drawWpGraph();
  drawMaterialGraph();
  refreshOverlays();
}

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
}

/* ============================================================
   11.5 · SETTINGS, RECORD, HINT ARROW & VICTORY BURST
   ============================================================ */
function applySettings() {
  const s = loadLS(SETTINGS_KEY, null);
  if (!s) return;
  state.mode = s.mode ?? 'engine';
  state.difficulty = s.difficulty ?? 'club';
  state.preferredColor = s.preferredColor ?? 'w';
  state.sound = s.sound ?? true;
  state.flipped = !!s.flipped;
  state.view2d = !!s.view2d;
}
function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      mode: state.mode, difficulty: state.difficulty,
      preferredColor: state.preferredColor, sound: state.sound,
      flipped: state.flipped, view2d: state.view2d,
    }));
  } catch { /* private mode */ }
}
function renderRecord() {
  const el = $('#record-line');
  if (el) el.innerHTML = `Record vs FENTSTEIN-TEHN · <b>${record.w}W</b> · ${record.d}D · <b>${record.l}L</b>`;
}
function syncSettingsUI() {
  $('#mode-seg').querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
  $('#color-seg').querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.color === state.preferredColor));
  diffGrid.querySelectorAll('.diff-btn').forEach((b) => b.classList.toggle('active', b.dataset.id === state.difficulty));
  $('#btn-sound').textContent = state.sound ? 'Sound On' : 'Sound Off';
  const lanCard = $('#lan-card');
  if (lanCard) lanCard.classList.toggle('hidden', state.mode !== 'lan');
  $('#engine-opts').style.display = state.mode === 'engine' ? 'block' : 'none';
  $('#record-line').style.display = state.mode === 'engine' ? 'block' : 'none';
  const viewBtn = $('#btn-view');
  if (viewBtn) viewBtn.textContent = state.view2d ? '3D' : '2D';
  if (state.mode === 'lan') {
    footState.textContent = `lan · ${state.lanCode ? 'room ' + state.lanCode : 'not connected'}`;
  } else {
    footState.textContent = state.mode === 'engine'
      ? `fentstein-tehn · ${currentDiff().label.toLowerCase()}` : 'two-player mode';
  }
}

/* ============================================================
   11.6 · LAN MULTIPLAYER (WebSocket rooms on /lan)
   ============================================================ */
function lanFillHost() {
  const el = $('#lan-host');
  if (el) el.textContent = location.host || 'this host';
}
function lanStatus(text, on) {
  const el = $('#lan-status');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('lan-status-on', !!on);
  el.classList.toggle('lan-status-off', !on);
}
function lanCancelEngine() {
  // A Stockfish search started in another mode must never inject a move into a LAN game.
  engineSend('stop');
  state.engineGen++;
  state.engineToken = state.hintToken = null;
  state.engineThinking = false;
  state.hintThinking = false;
  state.engineSearchFen = null;
  if (state.blackTimer) { clearTimeout(state.blackTimer); state.blackTimer = null; }
  thinkingEl.classList.add('hidden');
}
function lanTurnStatus() {
  if (!state.lanPeer) { lanStatus('Waiting for opponent…', state.lanConnected); return; }
  const side = game.turn() === 'w' ? 'White' : 'Black';
  const mine = game.turn() === state.lanColor;
  lanStatus(`${side} to move — ${mine ? 'your move' : "opponent's move"}`, true);
}
function lanSend(obj) {
  const ws = state.lanSocket;
  if (!ws || ws.readyState !== ws.OPEN) return false;
  try { ws.send(JSON.stringify(obj)); return true; } catch { return false; }
}
function lanDisconnect() {
  const ws = state.lanSocket;
  state.lanSocket = null;
  state.lanConnected = false;
  state.lanPeer = false;
  state.lanColor = null;
  state.lanMovePending = false;
  if (ws) {
    ws._lanClosing = true; // intentional close — don't show "connection lost"
    try { ws.close(); } catch (_) {}
  }
}
function lanConnect(mode, code) {
  lanDisconnect();
  state.lanCode = null;
  const codeEl = $('#lan-code');
  if (codeEl) codeEl.textContent = '—';
  lanFillHost();
  lanStatus('Connecting…', false);
  syncSettingsUI();

  let ws;
  try {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/lan');
  } catch (_) {
    lanStatus('Connection failed', false);
    showToast('Could not open LAN connection');
    return;
  }
  state.lanSocket = ws;
  let toasted = false; // at most one disconnect toast per attempt

  const dropped = () => {
    if (state.lanSocket === ws) {
      state.lanSocket = null;
      state.lanConnected = false;
      state.lanPeer = false;
      state.lanColor = null;
      lanStatus('Not connected', false);
      syncSettingsUI();
    }
    if (!ws._lanClosing && !toasted) {
      toasted = true;
      showToast('LAN connection lost');
    }
  };

  ws.onopen = () => {
    if (state.lanSocket !== ws) return;
    lanSend(mode === 'join' ? { t: 'join', code } : { t: 'create' });
  };
  ws.onerror = dropped;
  ws.onclose = dropped;

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (state.lanSocket !== ws) return; // stale socket — ignore late messages

    switch (msg.t) {
      case 'joined': {
        state.lanCode = msg.code ?? null;
        state.lanColor = msg.color === 'b' ? 'b' : 'w';
        state.lanConnected = true;
        state.lanPeer = !msg.waiting;
        if (codeEl) codeEl.textContent = msg.code || '—';
        lanFillHost();
        const side = state.lanColor === 'w' ? 'White' : 'Black';
        lanStatus(msg.waiting
          ? `Connected as ${side} — waiting for opponent…`
          : `Connected as ${side} — opponent joined`, true);
        syncSettingsUI();
        showToast(msg.waiting ? `Room ${msg.code} — waiting for opponent` : `Joined room ${msg.code}`);
        break;
      }

      case 'start': {
        lanCancelEngine();
        state.lanMovePending = false;
        // server snapshot is authoritative
        game.load(msg.fen);
        resetAnalytics();
        state.moveTimes = [];
        state.turnStartedAt = Date.now();
        state.over = false;
        state.winnerColor = null;
        state.lastAcc = null;
        state.recordPending = false;
        state.recordWritten = false;
        state.recordTs = null;
        state.engineThinking = false;
        state.hintThinking = false;
        state.selected = null;
        state.legalTargets = [];
        state.lastMove = null;
        state.pendingPromo = null;
        clearHintArrow();
        clearMarkers();
        $('#gameover').classList.add('hidden');
        $('#promo').classList.add('hidden');
        thinkingEl.classList.add('hidden');
        syncFromBoard();
        refreshUI();
        liveAnalyze();          // analysis only — never start the engine in LAN play
        state.lanPeer = true;
        lanTurnStatus();
        showToast('Opponent joined — game started');
        break;
      }

      case 'move': {
        state.lanMovePending = false;
        state.applyingRemote = true;
        try {
          let applied = false;
          try { applied = doMove(msg.from, msg.to, msg.promotion); } catch (_) { applied = false; }
          if (!applied || (msg.fen && game.fen() !== msg.fen)) {
            // out-of-sync echo: rebuild from the initial position and replay SAN
            game.reset();
            let rebuilt = true;
            try { for (const san of msg.history || []) game.move(san); } catch { rebuilt = false; }
            if (!rebuilt || (msg.fen && game.fen() !== msg.fen)) { if (msg.fen) game.load(msg.fen); }
            syncFromBoard();
            refreshOverlays();
            refreshUI();
          }
        } finally {
          state.applyingRemote = false;
          lanTurnStatus();
        }
        break;
      }

      case 'reset': {
        lanCancelEngine();
        state.lanMovePending = false;
        game.load(new Chess().fen());
        resetAnalytics();
        state.moveTimes = [];
        state.turnStartedAt = Date.now();
        state.over = false;
        state.winnerColor = null;
        state.lastAcc = null;
        state.recordPending = false;
        state.recordWritten = false;
        state.recordTs = null;
        state.engineThinking = false;
        state.hintThinking = false;
        state.selected = null;
        state.legalTargets = [];
        state.lastMove = null;
        state.pendingPromo = null;
        clearHintArrow();
        clearMarkers();
        $('#gameover').classList.add('hidden');
        $('#promo').classList.add('hidden');
        thinkingEl.classList.add('hidden');
        syncFromBoard();
        refreshUI();
        liveAnalyze();
        lanTurnStatus();
        showToast('New LAN game');
        break;
      }

      case 'error':
        state.lanMovePending = false; // server rejected the move; allow a retry
        showToast(msg.msg || 'LAN error');
        break;

      case 'peer-left':
        state.lanPeer = false;
        state.lanMovePending = false;
        lanStatus('Opponent left', false);
        showToast('Opponent left the game');
        break;
    }
  };
}

/* golden arrow showing Stockfish's recommended move */
function clearHintArrow() {
  if (!state.hintArrow) return;
  scene.remove(state.hintArrow);
  state.hintArrow.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
  state.hintArrow = null;
}
function drawHintArrow(from, to) {
  clearHintArrow();
  const a = squareCenter(from), b = squareCenter(to);
  const dir = new THREE.Vector3().subVectors(b, a); dir.y = 0;
  const len = dir.length();
  if (len < 0.05) return;
  dir.normalize();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffc94d, emissive: 0xffb43a, emissiveIntensity: 1.6,
    roughness: 0.3, metalness: 0.1, transparent: true, opacity: 0.96,
  });
  const group = new THREE.Group();
  const shaftLen = Math.max(len - 0.46, 0.25);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, shaftLen, 14), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.42, 18), mat);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const y = 1.18;
  const shaftMid = a.clone().addScaledVector(dir, shaftLen / 2 + 0.06);
  shaft.position.set(shaftMid.x, y, shaftMid.z);
  shaft.quaternion.copy(q);
  const headPos = a.clone().addScaledVector(dir, shaftLen + 0.26);
  head.position.set(headPos.x, y, headPos.z);
  head.quaternion.copy(q);
  shaft.castShadow = head.castShadow = true;
  group.add(shaft, head);
  scene.add(group);
  state.hintArrow = group;
}

function requestHint() {
  if (state.mode === 'lan') { showToast('Engine hints are disabled in LAN play'); return; }
  if (state.over) return;
  if (!engine || !state.engineReady) { showToast('FENTSTEIN-TEHN still loading…'); return; }
  if (state.engineThinking) { showToast('Wait for FENTSTEIN-TEHN to move…'); return; }
  if (state.hintThinking) return;
  state.hintThinking = true;
  state.hintFen = game.fen();
  state.hintToken = ++state.engineGen;
  engineSend('position fen ' + state.hintFen);
  engineSend('go depth 12');
  showToast('Consulting FENTSTEIN-TEHN…');
  sfx.select();
}

/* gold particle fountain on checkmate */
function spawnVictoryBurst() {
  const COUNT = 150;
  const pos = new Float32Array(COUNT * 3);
  const vel = [];
  for (let i = 0; i < COUNT; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 3.2;
    pos[i * 3 + 1] = 0.4 + Math.random() * 1.6;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 3.2;
    vel.push(new THREE.Vector3(
      (Math.random() - 0.5) * 3.6,
      2.4 + Math.random() * 2.8,
      (Math.random() - 0.5) * 3.6
    ));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xffd873, size: 0.1, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  state.bursts.push({ pts, vel, life: 0 });
}

/* ============================================================
   12 · CONTROLS & GAME FLOW
   ============================================================ */
function newGame() {
  if (state.mode === 'lan') {
    // clear local transient UI only; the room's reset is authoritative
    clearHintArrow();
    deselect();
    state.pendingPromo = null;
    $('#promo').classList.add('hidden');
    $('#gameover').classList.add('hidden');
    thinkingEl.classList.add('hidden');
    if (state.lanConnected && state.lanSocket) lanSend({ t: 'reset' });
    else lanConnect('create');
    return;
  }
  game.reset();
  state.over = false;
  state.engineThinking = false;
  state.selected = null;
  state.legalTargets = [];
  state.lastMove = null;
  state.pendingPromo = null;
  state.hintThinking = false;
  state.winnerColor = null;
  state.lastAcc = null;
  state.recordPending = false;
  state.recordWritten = false;
  if (state.blackTimer) { clearTimeout(state.blackTimer); state.blackTimer = null; }
  state.engineGen++; // invalidate every in-flight engine / hint reply
  state.engineToken = state.hintToken = null;
  state.engineSearchFen = null;
  clearHintArrow();
  state.playerColor =
    state.preferredColor === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : state.preferredColor;
  $('#promo').classList.add('hidden');
  $('#gameover').classList.add('hidden');
  thinkingEl.classList.add('hidden');
  clearMarkers();
  resetAnalytics();
  state.moveTimes = [];
  state.turnStartedAt = Date.now();
  state.gameDifficulty = state.difficulty;
  syncFromBoard();
  engineSend('stop');
  engineSend('ucinewgame');
  evalFill.style.height = '50%';
  evalLabel.textContent = '–';
  footDepth.textContent = '–';
  refreshUI();
  sfx.start();
  liveAnalyze();
  if (state.mode === 'engine' && state.playerColor === 'b') {
    state.blackTimer = setTimeout(() => { state.blackTimer = null; maybeRequestEngine(); }, 350);
  }
}

function undo() {
  if (state.mode === 'lan') { showToast('Undo is not available in LAN play'); return; }
  if (state.pendingPromo) return;
  engineSend('stop');
  if (state.blackTimer) { clearTimeout(state.blackTimer); state.blackTimer = null; }
  state.engineGen++; // invalidate every in-flight engine / hint reply
  state.engineToken = state.hintToken = null;
  state.engineSearchFen = null;
  state.engineThinking = false;
  state.hintThinking = false;
  state.recordPending = false;
  clearHintArrow();
  thinkingEl.classList.add('hidden');
  const wasOver = state.over;
  state.over = false;
  state.winnerColor = null;
  $('#gameover').classList.add('hidden');
  if (wasOver && state.mode === 'engine' && state.recordWritten) {
    // undo the entry + record increment written for the just-finished game
    const profile = loadProfile();
    const entry = profile.pop();
    if (entry) {
      saveProfile(profile); // keeps all older entries intact
      const key = entry.result === 'draw' ? 'd' : (entry.result === entry.pCol ? 'w' : 'l');
      record[key] = Math.max(0, (record[key] || 0) - 1);
      try { localStorage.setItem(RECORD_KEY, JSON.stringify(record)); } catch { /* private mode */ }
      renderRecord();
      refreshProfile();
    }
  }
  state.recordWritten = false;
  if (state.mode === 'engine') {
    // rewind until it's the player's move again
    for (let i = 0; i < 2; i++) {
      if (!game.undo()) break;
      if (game.turn() === state.playerColor) break;
    }
  } else {
    game.undo();
  }
  state.moveTimes = state.moveTimes.filter((t) => t.ply < game.history().length);
  state.turnStartedAt = Date.now();
  const hist = game.history({ verbose: true });
  const last = hist[hist.length - 1];
  state.lastMove = last ? { from: last.from, to: last.to } : null;
  deselect();
  syncFromBoard();
  resyncAnalysis();
  refreshUI();
  if (wasOver) showToast('Takeback — fight on!');
}

function setFlipped(flipped) {
  state.flipped = flipped;
  clearHintArrow();
  saveSettings();
  updateOrthoUp(); // the top-down view flips with the board
  const z = flipped ? -11.8 : 11.8;
  const tz = flipped ? -1.35 : 1.35;
  if (state.view2d) {
    // stay top-down, but remember the 3D pose for when we switch back
    camTween = null;
    camera.position.set(0, 8.8, z);
    controls.target.set(0, 0, tz);
  } else {
    camTween = {
      fromPos: camera.position.clone(),
      toPos: new THREE.Vector3(0, 8.8, z),
      fromTarget: controls.target.clone(),
      toTarget: new THREE.Vector3(0, 0, tz),
      t: 0,
    };
  }
  // knight facing must follow the flip
  for (const sq of Object.keys(pieces)) {
    const p = pieces[sq];
    if (p.userData.type === 'n') {
      const w = p.userData.color === 'w';
      p.rotation.y = (w !== flipped) ? Math.PI / 2 : -Math.PI / 2;
    }
  }
}

/* top-down orthographic view of the same board, or the normal 3D camera */
function setView2d(on) {
  state.view2d = !!on;
  if (tableGroup3D) tableGroup3D.visible = !state.view2d;
  if (tableFlat2D) tableFlat2D.visible = state.view2d;
  if (skyCloudsGroup) skyCloudsGroup.visible = !state.view2d;
  const btn = $('#btn-view');
  if (btn) btn.textContent = state.view2d ? '3D' : '2D';
  controls.enabled = !state.view2d;
  controls.enableRotate = !state.view2d;
  camTween = null;
  updateOrthoUp();
  resize();
  if (!state.view2d) {
    // restore the normal 3D pose for the current flip (same pose as setFlipped)
    const z = state.flipped ? -11.8 : 11.8;
    const tz = state.flipped ? -1.35 : 1.35;
    camera.position.set(0, 8.8, z);
    controls.target.set(0, 0, tz);
    controls.update();
  }
  saveSettings();
}

/* difficulty grid */
const diffGrid = $('#diff-grid');
for (const d of DIFFS) {
  const btn = document.createElement('button');
  btn.className = 'diff-btn' + (d.id === state.difficulty ? ' active' : '');
  btn.dataset.id = d.id;
  btn.innerHTML = `<b>${d.label}</b><small>${d.sub}</small>`;
  btn.addEventListener('click', () => {
    state.difficulty = d.id;
    diffGrid.querySelectorAll('.diff-btn').forEach((b) => b.classList.toggle('active', b === btn));
    applyDifficultyOption();
    footState.textContent = `fentstein-tehn · ${d.label.toLowerCase()}`;
    saveSettings();
  });
  diffGrid.appendChild(btn);
}

/* mode + color segmented controls */
$('#mode-seg').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg'); if (!btn) return;
  const prevMode = state.mode;
  state.mode = btn.dataset.mode;
  $('#mode-seg').querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b === btn));
  if (state.mode === 'lan') {
    lanCancelEngine();
    lanDisconnect();
    state.lanCode = null;
    const codeEl = $('#lan-code');
    if (codeEl) codeEl.textContent = '—';
    lanFillHost();
    $('#lan-card').classList.remove('hidden');
    $('#engine-opts').style.display = 'none';
    lanStatus('Not connected — create or join a game', false);
    syncSettingsUI();
    saveSettings();
    return; // no engine boot / newGame() in LAN mode
  }
  if (prevMode === 'lan') {
    lanDisconnect();
    $('#lan-card').classList.add('hidden');
  }
  syncSettingsUI();
  saveSettings();
  newGame();
});
$('#color-seg').addEventListener('click', (e) => {
  const btn = e.target.closest('.seg'); if (!btn) return;
  state.preferredColor = btn.dataset.color;
  $('#color-seg').querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b === btn));
  saveSettings();
  newGame();
});
$('#btn-new').addEventListener('click', newGame);
$('#btn-hint').addEventListener('click', requestHint);
$('#btn-analyze').addEventListener('click', toggleDeepAnalyze);
$('#btn-flip').addEventListener('click', () => setFlipped(!state.flipped));
$('#btn-view').addEventListener('click', () => setView2d(!state.view2d));
$('#btn-undo').addEventListener('click', undo);
$('#btn-sound').addEventListener('click', () => {
  state.sound = !state.sound;
  $('#btn-sound').textContent = state.sound ? 'Sound On' : 'Sound Off';
  saveSettings();
  if (state.sound) sfx.select();
});
$('#lan-create').addEventListener('click', () => lanConnect('create'));
$('#lan-join').addEventListener('click', () => {
  const input = $('#lan-join-code');
  const code = ((input?.value) || '').trim().toUpperCase();
  if (!code) { showToast('Enter a room code first'); input?.focus(); return; }
  lanConnect('join', code);
});
$('#lan-copy').addEventListener('click', async () => {
  if (!state.lanCode) { showToast('No room code yet'); return; }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(state.lanCode);
      showToast('Room code copied: ' + state.lanCode);
      return;
    }
  } catch (_) { /* clipboard blocked — fall back to showing the code */ }
  showToast('Room code: ' + state.lanCode);
});
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'n') newGame();
  else if (k === 'f') setFlipped(!state.flipped);
  else if (k === 'u') undo();
  else if (k === 'h') requestHint();
  else if (k === 'm') $('#btn-sound').click();
  else if (k === 'v' && !/^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '')) setView2d(!state.view2d);
});
$('#gameover-again').addEventListener('click', newGame);

/* ============================================================
   13 · RESIZE & RENDER LOOP
   ============================================================ */
function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  // orthographic frustum: keep square pixels and fit the whole board in either orientation
  const half = 5.1;
  if (aspect < 1) {
    orthoCam.left = -half;
    orthoCam.right = half;
    orthoCam.top = half / aspect;
    orthoCam.bottom = -half / aspect;
  } else {
    orthoCam.left = -half * aspect;
    orthoCam.right = half * aspect;
    orthoCam.top = half;
    orthoCam.bottom = -half;
  }
  orthoCam.updateProjectionMatrix();
  drawEvalGraph();
  drawWpGraph();
  drawMaterialGraph();
}
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (waterSurface && tableGroup3D.visible) waterSurface.material.uniforms.time.value += dt * 0.35;
  if (skyCloudsGroup && skyCloudsGroup.visible && !state.view2d) {
    for (const s of skyCloudsGroup.children) {
      s.position.x += dt * s.userData.drift;
      if (s.position.x > 55) s.position.x = -55;
    }
  }

  // camera flip tween
  if (camTween) {
    camTween.t += dt / 0.55;
    const k = camTween.t >= 1 ? 1 : 1 - Math.pow(2, -8 * camTween.t);
    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, k);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, k);
    if (camTween.t >= 1) camTween = null;
  }

  // piece animations (hop arcs)
  for (let i = anims.length - 1; i >= 0; i--) {
    const a = anims[i];
    a.t += dt / a.dur;
    const t = Math.min(a.t, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    if (a.shrink) {
      const s = Math.max(0.001, 1 - ease);
      a.g.scale.setScalar(s);
      a.g.position.y = a.from.y + ease * 0.25;
      if (t >= 1) { scene.remove(a.g); anims.splice(i, 1); }
      continue;
    }
    a.g.position.lerpVectors(a.from, a.dest, ease);
    a.g.position.y = THREE.MathUtils.lerp(a.from.y, SURF_Y, ease) + Math.sin(Math.PI * t) * a.hop;
    if (t >= 1) {
      a.g.position.y = SURF_Y;
      anims.splice(i, 1);
      a.onDone?.();
    }
  }

  controls.update();
  updateWatch();

  // hint arrow pulse
  if (state.hintArrow) {
    const s = 1 + 0.045 * Math.sin(clock.elapsedTime * 5);
    state.hintArrow.scale.set(s, 1, s);
  }

  // victory particle bursts
  for (let i = state.bursts.length - 1; i >= 0; i--) {
    const b = state.bursts[i];
    b.life += dt;
    const attr = b.pts.geometry.attributes.position;
    for (let j = 0; j < b.vel.length; j++) {
      b.vel[j].y -= 4.4 * dt;
      attr.array[j * 3] += b.vel[j].x * dt;
      attr.array[j * 3 + 1] += b.vel[j].y * dt;
      attr.array[j * 3 + 2] += b.vel[j].z * dt;
      if (attr.array[j * 3 + 1] < 0.05) { attr.array[j * 3 + 1] = 0.05; b.vel[j].set(0, 0, 0); }
    }
    attr.needsUpdate = true;
    b.pts.material.opacity = Math.max(0, 1 - b.life / 1.9);
    if (b.life > 1.9) {
      scene.remove(b.pts);
      b.pts.geometry.dispose();
      b.pts.material.dispose();
      state.bursts.splice(i, 1);
    }
  }

  renderer.render(scene, activeCam());
}

/* Debug/test hook: project a square to viewport pixels */
window.__royal = {
  toScreen(sq) {
    const rect = canvas.getBoundingClientRect();
    const p = sqToWorld(sq);
    const v = new THREE.Vector3(p.x, SURF_Y, p.z).project(activeCam());
    return { x: rect.left + (v.x * 0.5 + 0.5) * rect.width, y: rect.top + (-v.y * 0.5 + 0.5) * rect.height };
  },
  fen: () => game.fen(),
  turn: () => game.turn(),
};

/* ============================================================
   14 · BOOT
   ============================================================ */
applySettings();
syncSettingsUI();
state.gameDifficulty = state.difficulty; // freeze the level for the first game after load
state.playerColor = state.preferredColor === 'random'
  ? (Math.random() < 0.5 ? 'w' : 'b') : state.preferredColor;
renderRecord();
lanFillHost();
if (state.mode === 'lan') lanStatus('Not connected — create or join a game', false); // no auto-connect
if (state.flipped) {
  camera.position.set(0, 8.8, -11.8);
  controls.target.set(0, 0, -1.35);
}
resize();
if (state.view2d) setView2d(true); // restore the saved top-down view
syncFromBoard();
refreshUI();
refreshProfile();
liveAnalyze();

/* ============================================================
   15 · AI COACH (BYO OpenAI-compatible key)
   ============================================================ */
const AI_BASE_KEY = 'royal-ai-base';
const AI_MODEL_KEY = 'royal-ai-model';
const AI_KEY_KEY = 'royal-ai-key';

const coach = {
  base: loadLS(AI_BASE_KEY, 'https://openrouter.ai/api/v1'),
  model: loadLS(AI_MODEL_KEY, 'openai/gpt-4o-mini'),
  key: loadLS(AI_KEY_KEY, ''),
  history: [],           // {role, content}
  busy: false,
};

const coachModal = $('#coach');
const coachThread = $('#coach-thread');
const coachInput = $('#coach-input');
const coachSend = $('#coach-send');
const coachStatus = $('#coach-status');

function saveLS(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

const KNOWN_BASES = ['https://openrouter.ai/api/v1', 'https://api.groq.com/openai/v1', 'https://api.openai.com/v1'];

function detectProviderFromKey(key) {
  if (key.startsWith('gsk_')) return { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', name: 'Groq' };
  if (key.startsWith('sk-or-')) return { base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', name: 'OpenRouter' };
  if (key.startsWith('sk-ant-')) return { base: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-3.5-sonnet', name: 'Anthropic (via OpenRouter)' };
  if (key.startsWith('sk-proj-') || key.startsWith('sk-')) return { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', name: 'OpenAI' };
  return null;
}

function coachSaveSettings() {
  const baseInput = $('#coach-base').value.trim().replace(/\/+$/, '');
  const keyInput = $('#coach-key').value.trim();
  const p = detectProviderFromKey(keyInput);
  let detected = null;
  // if the base URL is one of the app's defaults (or garbage), snap it to the key's provider
  if (p && (!baseInput || KNOWN_BASES.includes(baseInput))) {
    coach.base = p.base;
    coach.model = p.model;
    $('#coach-base').value = p.base;
    $('#coach-model').value = p.model;
    detected = p;
  } else {
    coach.base = baseInput || 'https://openrouter.ai/api/v1';
    coach.model = $('#coach-model').value.trim() || 'openai/gpt-4o-mini';
  }
  coach.key = keyInput;
  saveLS(AI_BASE_KEY, coach.base);
  saveLS(AI_MODEL_KEY, coach.model);
  saveLS(AI_KEY_KEY, coach.key);
  syncCoachStatus();
  $('#coach-settings').classList.add('hidden');
  if (detected) showToast(`Detected ${detected.name} key — endpoint set automatically`);
}
function coachForgetSettings() {
  coach.key = '';
  try { localStorage.removeItem(AI_KEY_KEY); } catch {}
  $('#coach-key').value = '';
  syncCoachStatus();
}

function syncCoachStatus() {
  const ok = coach.key.length > 8;
  coachStatus.textContent = ok ? `Connected · ${coach.model}` : 'Not connected — add a key';
  coachStatus.classList.toggle('ok', ok);
  coachStatus.classList.toggle('err', !ok);
  document.getElementById('btn-coach').classList.toggle('btn-coach-alert', !ok);
}

function coachContext() {
  const sans = game.history();
  const fen = game.fen();
  const turn = game.turn() === 'w' ? 'White' : 'Black';
  const inCheck = game.inCheck();
  const over = game.isGameOver();
  const op = openingName(sans);
  const evalCp = [...state.evalHistory].reverse().find((v) => v != null);
  const evalTxt = evalCp == null ? 'no eval yet' : (Math.abs(evalCp) >= 100000 ? (evalCp > 0 ? 'White mates' : 'Black mates') : `${evalCp >= 0 ? '+' : ''}${(evalCp / 100).toFixed(1)} (White POV)`);
  const mat = computeMaterialHistory();
  const matBal = mat.length ? mat[mat.length - 1] : 0;
  const youAre = state.mode === 'engine' ? (state.playerColor === 'w' ? 'White (you vs engine)' : 'Black (you vs engine)') : 'Both sides (local 2-player)';
  const engDiff = state.mode === 'engine' ? `engine difficulty: ${currentDiff().label}` : 'local two-player';
  const moves = sans.length ? sans.join(' ') : '(game has not started)';
  const lastEvalTxt = state.lastMove ? `Last move: ${sans[sans.length - 1]}` : 'No moves yet';
  return [
    `FEN: ${fen}`,
    `Side to move: ${turn}${inCheck ? ' (in check!)' : ''}`,
    `Game over: ${over}`,
    `Opening: ${op ?? 'unknown'}`,
    `Moves: ${moves}`,
    lastEvalTxt,
    `Engine eval: ${evalTxt}`,
    `Material balance: ${matBal >= 0 ? '+' : ''}${matBal} pawns (White POV)`,
    `You are: ${youAre} · ${engDiff}`,
  ].join('\n');
}

const COACH_SYSTEM = `You are Royal Coach — the personal chess coach inside Royal 3D Chess. You can SEE this game: every position arrives as FEN plus SAN move list, whose turn it is, FENTSTEIN-TEHN's evaluation, material balance and the opening. Your job:
- Give warm, direct, expert advice based ONLY on the actual position. Never invent a position.
- Be concise: 2-6 sentences for most questions. Use short lists only when comparing options.
- Suggest concrete moves in SAN notation, always grounded in the FEN and moves given.
- When the player made a mistake you can see (big eval swing or an obvious blunder), say so plainly and explain the better idea.
- Speak like a strong human coach, not a chess engine — explain the "why" briefly.
- If asked about something off-topic, politely steer back to chess.
The player plays chess at casual level — never assume master knowledge.`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function mdLite(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  const lines = html.split('\n');
  const out = [];
  let inList = false;
  for (const line of lines) {
    const m = line.match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${m[1]}</li>`);
    } else {
      if (inList) { out.push('</ul>'); inList = false; }
      out.push(line ? `<p>${line}</p>` : '');
    }
  }
  if (inList) out.push('</ul>');
  return out.join('');
}
function appendCoachMessage(role, content) {
  const el = document.createElement('div');
  el.className = `coach-msg ${role}`;
  if (role === 'coach') {
    el.innerHTML = `<span class="coach-meta">Royal Coach</span>${mdLite(content)}`;
  } else {
    el.textContent = content;
  }
  coachThread.appendChild(el);
  coachThread.scrollTop = coachThread.scrollHeight;
  return el;
}
function showCoachThinking() {
  const el = document.createElement('div');
  el.className = 'coach-msg coach';
  el.id = 'coach-typing';
  el.innerHTML = `<span class="coach-meta">Royal Coach</span><span class="coach-typing">coach is thinking<span class="coach-dots"><i></i><i></i><i></i></span></span>`;
  coachThread.appendChild(el);
  coachThread.scrollTop = coachThread.scrollHeight;
  return el;
}
function clearCoachThread() {
  coachThread.innerHTML = '';
  appendCoachMessage('coach', "I can see your game — the position, every move, the evaluation. To start, paste your OpenAI-compatible key below, press Save key, then ask anything: why your last move was wrong, what to play next, or what to study.");
}

async function coachSendMessage(text) {
  if (coach.busy) return;
  if (!coach.key) { $('#coach-settings').classList.remove('hidden'); showToast('Add an OpenAI-compatible API key first (🔑 Key)'); return; }
  const q = text.trim();
  if (!q) return;
  appendCoachMessage('user', q);
  coachInput.value = '';
  coachInput.style.height = 'auto';
  coach.history.push({ role: 'user', content: q });
  const typing = showCoachThinking();
  coach.busy = true;
  coachSend.disabled = true;
  try {
    const res = await fetch(coach.base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${coach.key}` },
      body: JSON.stringify({
        model: coach.model,
        max_tokens: 420,
        temperature: 0.5,
        messages: [
          { role: 'system', content: COACH_SYSTEM },
          { role: 'system', content: `CURRENT GAME STATE:\n${coachContext()}` },
          ...coach.history.slice(-12),
        ],
      }),
    });
    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch {}
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || raw.slice(0, 220) || `HTTP ${res.status}`;
      throw new Error(`API ${res.status}: ${msg}`);
    }
    const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content && data.choices[0].message.content.trim();
    if (!reply) throw new Error('Empty response from the model');
    typing.remove();
    coach.history.push({ role: 'assistant', content: reply });
    appendCoachMessage('coach', reply);
  } catch (err) {
    typing.remove();
    const msg = String((err && err.message) || err);
    appendCoachMessage('coach', `I couldn't reach the coach — ${msg}. If you're not on the same network as the engine, CORS blocks some providers; OpenRouter or a local proxy works. Check the 🔑 Key tab — press Test to see the raw provider error, and make sure Base URL matches your key's service (Groq needs https://api.groq.com/openai/v1).`);
    coach.history.pop(); // don't keep the failed user msg in history
  } finally {
    coach.busy = false;
    coachSend.disabled = false;
  }
}

function toggleCoach(open) {
  const show = open ?? coachModal.classList.contains('hidden');
  coachModal.classList.toggle('hidden', !show);
  if (show) {
    if (!coachThread.children.length) clearCoachThread();
    coachInput.focus();
  }
}

$('#btn-coach').addEventListener('click', () => toggleCoach(true));
$('#coach-close').addEventListener('click', () => toggleCoach(false));
$('#coach').addEventListener('click', (e) => { if (e.target.id === 'coach') toggleCoach(false); });
$('#coach-settings-toggle').addEventListener('click', () => $('#coach-settings').classList.toggle('hidden'));
$('#coach-save').addEventListener('click', coachSaveSettings);
$('#coach-forget').addEventListener('click', coachForgetSettings);

async function coachTestConnection() {
  const result = $('#coach-test-result');
  const baseInput = $('#coach-base').value.trim().replace(/\/+$/, '') || 'https://openrouter.ai/api/v1';
  const modelInput = $('#coach-model').value.trim() || 'openai/gpt-4o-mini';
  const keyInput = $('#coach-key').value.trim();
  if (!keyInput) { result.textContent = 'Paste your key first.'; result.className = 'coach-test-result err'; return; }
  result.textContent = 'Testing…';
  result.className = 'coach-test-result pending';
  const base = baseInput;
  const model = modelInput;
  const t0 = performance.now();
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyInput}` },
      body: JSON.stringify({ model, max_tokens: 4, temperature: 0, messages: [{ role: 'user', content: 'Reply with exactly: ok' }] }),
    });
    const raw = await res.text();
    let data = null;
    try { data = JSON.parse(raw); } catch {}
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || raw.slice(0, 160) || `HTTP ${res.status}`;
      result.textContent = `✗ ${res.status} — ${msg}`;
      result.className = 'coach-test-result err';
      return;
    }
    result.textContent = `✓ Connected in ${ms} ms — ${model}`;
    result.className = 'coach-test-result ok';
  } catch (err) {
    result.textContent = `✗ ${String((err && err.message) || err)}`;
    result.className = 'coach-test-result err';
  }
}
$('#coach-test').addEventListener('click', coachTestConnection);
$('#coach-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (chip) coachSendMessage(chip.dataset.q);
});
$('#coach-form').addEventListener('submit', (e) => { e.preventDefault(); coachSendMessage(coachInput.value); });
coachInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); coachSendMessage(coachInput.value); }
});
coachInput.addEventListener('input', () => {
  coachInput.style.height = 'auto';
  coachInput.style.height = Math.min(coachInput.scrollHeight, 110) + 'px';
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !coachModal.classList.contains('hidden')) toggleCoach(false);
});
$('#coach-base').value = coach.base;
$('#coach-model').value = coach.model;
$('#coach-key').value = coach.key;
syncCoachStatus();
if (!coach.key) $('#coach-settings').classList.remove('hidden');

tick();


/* ============================================================
   16 · LOCAL TRACKING SDK
   ============================================================ */

function loadProfile() {
  const d = loadLS(PROFILE_KEY, []);
  if (!Array.isArray(d)) return [];
  // drop non-finite numbers anywhere in an entry (including nested stat buckets)
  const finiteNumbers = (obj) => {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'number' && !Number.isFinite(v)) delete obj[k];
      else if (v && typeof v === 'object' && !Array.isArray(v)) finiteNumbers(v);
    }
    return obj;
  };
  return d.slice(-MAX_PROFILE_GAMES)
    .filter((x) => x && typeof x === 'object' && !Array.isArray(x))
    .map((x) => {
      const out = finiteNumbers({ ...x });
      out.pCol = x.pCol === 'b' ? 'b' : 'w';
      out.result = (x.result === 'w' || x.result === 'b' || x.result === 'draw') ? x.result : 'draw';
      out.diff = typeof x.diff === 'string' ? x.diff : 'casual';
      return out;
    });
}
function saveProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p.slice(-MAX_PROFILE_GAMES))); } catch {}
}

function blunderCounts(verbose) {
  const out = { w: 0, b: 0 };
  for (let i = 0; i < verbose.length; i++) {
    if (state.moveTags[i] === '??') out[verbose[i].color]++;
  }
  return out;
}

function avgCpLoss(verbose, evals) {
  const sums = { w: 0, b: 0 }, counts = { w: 0, b: 0 };
  for (let i = 1; i <= verbose.length; i++) {
    const before = evals[i - 1], after = evals[i];
    if (before == null || after == null) continue;
    const mover = verbose[i - 1].color;
    const sign = mover === 'w' ? 1 : -1;
    const loss = Math.max(0, sign * (before - after));
    if (loss > 10000) continue; // skip mate swings distorting average
    sums[mover] += loss;
    counts[mover]++;
  }
  return { w: counts.w ? Math.round(sums.w / counts.w) : null, b: counts.b ? Math.round(sums.b / counts.b) : null };
}

/* phase classification: opening (<20 ply), endgame (<=8 non-pawn/non-king pieces), else middlegame */
function phaseOfPly(ply, nonPawnCount) {
  if (ply < 20) return 'open';
  if (nonPawnCount <= 8) return 'end';
  return 'mid';
}

function phasesForHistory(verbose) {
  const tmp = new Chess();
  const phases = [];
  for (let i = 0; i < verbose.length; i++) {
    const mv = verbose[i];
    try {
      const req = { from: mv.from, to: mv.to };
      if (mv.promotion) req.promotion = mv.promotion;
      tmp.move(req);
    } catch {
      phases.push(phaseOfPly(i, 16));
      continue;
    }
    let nonPawn = 0;
    for (const row of tmp.board()) {
      for (const sq of row) {
        if (sq && sq.type !== 'p' && sq.type !== 'k') nonPawn++;
      }
    }
    phases.push(phaseOfPly(i, nonPawn));
  }
  return phases;
}

function computePhaseStats(verbose, evals, moveTimes, userColor) {
  const phases = phasesForHistory(verbose);
  const timeByPly = new Map();
  for (const t of moveTimes || []) timeByPly.set(t.ply, t);
  const empty = () => ({ moves: 0, accSum: 0, lossSum: 0, evalCount: 0, blunders: 0, thinkSum: 0, thinkCount: 0, rush: 0, acc: null, cpLoss: null, blundersPerMove: null });
  const out = { open: empty(), mid: empty(), end: empty() };
  const evalList = evals || [];
  for (let j = 0; j < verbose.length; j++) {
    if (verbose[j].color !== userColor) continue;
    const st = out[phases[j]];
    if (!st) continue;
    st.moves++;
    const before = evalList[j], after = evalList[j + 1];
    if (before != null && after != null) {
      const sign = userColor === 'w' ? 1 : -1;
      const loss = Math.max(0, sign * (before - after));
      if (loss <= 10000) { // skip mate swings, matching avgCpLoss()
        st.accSum += 100 * Math.exp(-0.0008 * loss);
        st.lossSum += loss;
        st.evalCount++;
      }
    }
    if (state.moveTags[j] === '??') st.blunders++;
    const t = timeByPly.get(j);
    if (t && typeof t.ms === 'number' && t.ms <= 60000) { // ignore idle / away-from-board time
      st.thinkSum += t.ms;
      st.thinkCount++;
      if (t.ms < 2000) st.rush++;
    }
  }
  for (const key of ['open', 'mid', 'end']) {
    const st = out[key];
    st.acc = st.evalCount ? st.accSum / st.evalCount : null;
    st.cpLoss = st.evalCount ? Math.round(st.lossSum / st.evalCount) : null;
    st.blundersPerMove = st.moves ? st.blunders / st.moves : null;
  }
  return out;
}

function recordProfileEntry(ts = null) {
  // only track games played against the engine; two-player on one machine knows nothing useful about "the user"
  if (state.mode !== 'engine') return;
  const verbose = game.history({ verbose: true });
  if (!verbose.length) return;
  // recompute from the final position — async analysis may have finished after the last UI refresh
  computeTags();
  state.lastAcc = computeAccuracies();
  const acc = state.lastAcc;
  const losses = avgCpLoss(verbose, state.evalHistory);
  const blunders = blunderCounts(verbose);
  let evalPairs = 0; // usable before/after eval pairs for the user's own moves
  const sign = state.playerColor === 'w' ? 1 : -1;
  for (let i = 1; i <= verbose.length; i++) {
    if (verbose[i - 1].color !== state.playerColor) continue;
    const before = state.evalHistory[i - 1], after = state.evalHistory[i];
    if (before == null || after == null) continue;
    if (sign * (before - after) > 10000) continue; // mate swing
    evalPairs++;
  }
  const analysed = state.evalHistory.reduce((n, v) => n + (v != null ? 1 : 0), 0);
  const thinkW = state.moveTimes.filter((t) => t.color === 'w' && t.ms <= 60000);
  const thinkB = state.moveTimes.filter((t) => t.color === 'b' && t.ms <= 60000);
  const thinkMsW = thinkW.length ? Math.round(thinkW.reduce((s, t) => s + t.ms, 0) / thinkW.length) : 0;
  const thinkMsB = thinkB.length ? Math.round(thinkB.reduce((s, t) => s + t.ms, 0) / thinkB.length) : 0;
  const phases = computePhaseStats(verbose, state.evalHistory, state.moveTimes, state.playerColor);
  const opening = openingName(game.history()) || 'Unorthodox / Offbeat Play';
  const result = game.isCheckmate() ? (game.turn() === 'w' ? 'b' : 'w') : 'draw';
  const entry = {
    ts: ts ?? Date.now(),
    mode: 'engine',
    diff: state.gameDifficulty || state.difficulty,
    pCol: state.playerColor,
    result,
    evalPairs,
    analysed,
    moves: verbose.length,
    accW: acc.wAcc != null ? Math.round(acc.wAcc) : null,
    accB: acc.bAcc != null ? Math.round(acc.bAcc) : null,
    lossW: losses.w,
    lossB: losses.b,
    blundersW: blunders.w,
    blundersB: blunders.b,
    thinkMsW,
    thinkMsB,
    open: opening,
    phases,
    thinkPhases: {
      open: { sum: phases.open.thinkSum, count: phases.open.thinkCount, rush: phases.open.rush },
      mid:  { sum: phases.mid.thinkSum, count: phases.mid.thinkCount, rush: phases.mid.rush },
      end:  { sum: phases.end.thinkSum, count: phases.end.thinkCount, rush: phases.end.rush },
    },
  };
  const profile = loadProfile().filter((x) => x.ts !== entry.ts); // replacing a refined entry, not duplicating it
  profile.push(entry);
  saveProfile(profile);
  refreshProfile();
}

function setPstat(id, val, cls) {
  const el = document.getElementById(id);
  if (el) { el.textContent = val; el.className = cls || ''; }
}

function setTrackingStat(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}
function clearTrackingList(id) {
  const el = document.getElementById(id);
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}
function addTrackingRow(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  const row = document.createElement('div');
  row.textContent = text;
  el.appendChild(row);
}

function refreshTrackingAnalytics(games) {
  const withNew = games.filter((x) => x && x.phases && x.thinkPhases);
  const phaseKeys = ['open', 'mid', 'end'];
  const phaseStatIds = { open: 'ph-open', mid: 'ph-mid', end: 'ph-end' };
  const phaseTimeIds = { open: 'time-open', mid: 'time-mid', end: 'time-end' };

  // per-phase accuracy / centipawn loss / blunders for the user's colour
  for (const key of phaseKeys) {
    let accSum = 0, evalCount = 0, lossSum = 0, blunders = 0, moves = 0;
    for (const x of withNew) {
      const st = x.phases[key];
      if (!st) continue;
      accSum += Number(st.accSum) || 0;
      lossSum += Number(st.lossSum) || 0;
      evalCount += Number(st.evalCount) || 0;
      blunders += Number(st.blunders) || 0;
      moves += Number(st.moves) || 0;
    }
    if (!evalCount && !moves) { setTrackingStat(phaseStatIds[key], '–'); continue; }
    // too few evaluated moves for a meaningful percentage — be explicit about the gap
    if (evalCount < Math.max(6, Math.ceil(moves * 0.6))) {
      setTrackingStat(phaseStatIds[key], `Need more analysis (${evalCount}/${moves})`);
      continue;
    }
    const acc = Math.round(accSum / evalCount);
    const cp = Math.round(lossSum / evalCount);
    const bl = moves ? (blunders / moves).toFixed(2) : (0).toFixed(2);
    setTrackingStat(phaseStatIds[key], `Est ${acc}% (${evalCount}/${moves}) · loss ${cp}cp · ${bl}/mv`);
  }

  // average think time per phase + rush rate (user moves under 2s)
  let rush = 0, timed = 0;
  for (const key of phaseKeys) {
    let sum = 0, count = 0;
    for (const x of withNew) {
      const tp = x.thinkPhases[key];
      if (!tp) continue;
      sum += tp.sum || 0;
      count += tp.count || 0;
      rush += tp.rush || 0;
      timed += tp.count || 0;
    }
    setTrackingStat(phaseTimeIds[key], count ? (sum / count / 1000).toFixed(1) + 's' : '–');
  }
  setTrackingStat('time-rush', timed ? `${rush}/${timed} (${Math.round(rush / timed * 100)}%)` : '–');

  // opening repertoire: top 5 by games played
  clearTrackingList('opening-list');
  const openings = new Map();
  for (const x of games) {
    if (!x || typeof x.open !== 'string' || !x.open) continue;
    let rec = openings.get(x.open);
    if (!rec) { rec = { games: 0, w: 0, d: 0, l: 0, accSum: 0, accN: 0 }; openings.set(x.open, rec); }
    rec.games++;
    if (x.result === 'draw') rec.d++;
    else if (x.result === x.pCol) rec.w++;
    else rec.l++;
    const acc = x.pCol === 'w' ? x.accW : x.accB;
    if (acc != null) { rec.accSum += acc; rec.accN++; }
  }
  const topOpenings = [...openings.entries()].sort((a, b) => b[1].games - a[1].games).slice(0, 5);
  for (const [name, rec] of topOpenings) {
    const accTxt = rec.accN ? Math.round(rec.accSum / rec.accN) + '%' : '–';
    addTrackingRow('opening-list', `${name} — ${rec.games} ${rec.games === 1 ? 'game' : 'games'} · ${rec.w}-${rec.d}-${rec.l} · est acc ${accTxt}`);
  }

  // difficulty ladder: one row per level with games
  clearTrackingList('ladder-list');
  const ladder = new Map();
  for (const x of games) {
    if (!x) continue;
    let rec = ladder.get(x.diff);
    if (!rec) { rec = { games: 0, wins: 0, accSum: 0, accN: 0 }; ladder.set(x.diff, rec); }
    rec.games++;
    if (x.result === x.pCol) rec.wins++;
    const acc = x.pCol === 'w' ? x.accW : x.accB;
    if (acc != null) { rec.accSum += acc; rec.accN++; }
  }
  for (const d of DIFFS) {
    const rec = ladder.get(d.id);
    if (!rec || !rec.games) continue;
    const accTxt = rec.accN ? Math.round(rec.accSum / rec.accN) + '%' : '–';
    addTrackingRow('ladder-list', `${d.label} — ${rec.games} ${rec.games === 1 ? 'game' : 'games'} · ${Math.round(rec.wins / rec.games * 100)}% win · est acc ${accTxt}`);
  }
}

function refreshProfile() {
  const profile = loadProfile();
  const g = profile.filter((p) => p.mode === 'engine');
  refreshTrackingAnalytics(g);
  if (!g.length) {
    setPstat('p-games', '0'); setPstat('p-wdl', '0-0-0'); setPstat('p-wrate', '–');
    setPstat('p-acc', '–'); setPstat('p-loss', '–'); setPstat('p-blunder', '–');
    const strk = document.getElementById('profile-streak');
    if (strk) strk.innerHTML = 'Streak vs FENTSTEIN-TEHN · <b>—</b> <span style="opacity:.55">· avg —</span>';
    setPstat('glabel-trend', '–');
    drawAccuracyTrend([]);
    return;
  }
  const wins = g.filter((x) => x.result === x.pCol).length;
  const draws = g.filter((x) => x.result === 'draw').length;
  const losses = g.length - wins - draws;
  const winRate = Math.round((wins / g.length) * 100);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) : null);
  const accs = g.map((x) => (x.pCol === 'w' ? x.accW : x.accB)).filter((v) => v != null);
  const cps  = g.map((x) => (x.pCol === 'w' ? x.lossW : x.lossB)).filter((v) => v != null);
  const bls  = g.map((x) => (x.pCol === 'w' ? x.blundersW : x.blundersB)).filter((v) => v != null);
  const thr  = g.map((x) => (x.pCol === 'w' ? x.thinkMsW : x.thinkMsB)).filter((v) => v > 0);
  const avgAcc = avg(accs), avgLoss = avg(cps), avgBl = avg(bls);
  const avgThink = thr.length ? Math.round(thr.reduce((s, v) => s + v, 0) / thr.length) : null;

  setPstat('p-games', String(g.length));
  setPstat('p-wdl', `${wins}-${draws}-${losses}`);
  setPstat('p-wrate', winRate + '%', winRate >= 55 ? 'good' : winRate <= 40 ? 'hot' : '');
  setPstat('p-acc', avgAcc != null ? avgAcc + '%' : '–', avgAcc != null && avgAcc >= 75 ? 'good' : avgAcc != null && avgAcc < 55 ? 'hot' : '');
  setPstat('p-loss', avgLoss != null ? avgLoss + 'cp' : '–');
  setPstat('p-blunder', avgBl != null ? avgBl.toFixed(1) : '–', avgBl != null && avgBl > 1.5 ? 'hot' : '');

  // streak vs Stockfish
  const last = g[g.length - 1];
  const outcomeOf = (x) => (x.result === 'draw' ? 'draw' : (x.result === x.pCol ? 'W' : 'L'));
  let streak = 0;
  const o = outcomeOf(last);
  if (o !== 'draw') {
    for (let i = g.length - 1; i >= 0; i--) {
      if (outcomeOf(g[i]) === o) streak++; else break;
    }
  }
  const streakTxt = o === 'draw' ? '—' : `${o}${streak}`;
  const thrTxt = avgThink != null ? `${(avgThink / 1000).toFixed(1)}s/move` : '—';
  const strk = document.getElementById('profile-streak');
  if (strk) strk.innerHTML = `Streak vs FENTSTEIN-TEHN · <b>${streakTxt}</b> <span style="opacity:.55">· avg ${thrTxt}</span>`;

  const last20 = g.slice(-20);
  const trend = last20.map((x) => (x.pCol === 'w' ? x.accW : x.accB));
  const trendAvg = avg(trend.filter((v) => v != null));
  setPstat('glabel-trend', trendAvg != null ? trendAvg + '%' : '–');
  drawAccuracyTrend(trend);
}

function drawAccuracyTrend(values) {
  const canvas = document.getElementById('acc-trend-graph');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const pts = values.map((v, i) => ({ i, v })).filter((p) => p.v != null);
  if (pts.length < 2) {
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('play vs engine to build a trend', w / 2, h / 2 + 3);
    return;
  }
  const xFor = (i) => 10 + (i / (values.length - 1)) * (w - 20);
  const yFor = (v) => h - 7 - (Math.min(100, Math.max(0, v)) / 100) * (h - 14);
  for (const g of [25, 50, 75]) {
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, yFor(g)); ctx.lineTo(w, yFor(g)); ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0) ctx.moveTo(xFor(p.i), yFor(p.v)); else ctx.lineTo(xFor(p.i), yFor(p.v));
  }
  ctx.strokeStyle = '#e6c369';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(230,195,105,.55)';
  ctx.shadowBlur = 6;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.lineTo(xFor(pts[pts.length - 1].i), h - 6);
  ctx.lineTo(xFor(pts[0].i), h - 6);
  ctx.closePath();
  ctx.fillStyle = 'rgba(230,195,105,.13)';
  ctx.fill();
  const last = pts[pts.length - 1];
  ctx.beginPath(); ctx.arc(xFor(last.i), yFor(last.v), 3.5, 0, Math.PI * 2); ctx.fillStyle = '#f6d98a'; ctx.fill();
}

document.getElementById('btn-reset-profile')?.addEventListener('click', () => {
  if (!confirm('Erase locally-tracked games, stats and record?')) return;
  try {
    localStorage.removeItem(PROFILE_KEY);
    localStorage.removeItem(RECORD_KEY);
  } catch {}
  record = { w: 0, d: 0, l: 0 };
  renderRecord();
  refreshProfile();
  showToast('Local tracking data cleared');
});
