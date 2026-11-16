/* ============================================================
   LESTRAMK CLASSIC — a procedural dress watch for the 3D scene
   Canvas-drawn dial (snailing, Roman numerals), leather strap
   with stitching, brushed steel case, live sweeping hands.
   ============================================================ */
import * as THREE from 'three';

const TAU = Math.PI * 2;
const D2R = Math.PI / 180;

function makeDialTexture() {
  const S = 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, cy = S / 2;

  // base: near-black radial gradient
  const base = g.createRadialGradient(cx, cy, S * 0.08, cx, cy, S * 0.52);
  base.addColorStop(0, '#1b1b1b');
  base.addColorStop(0.75, '#111');
  base.addColorStop(1, '#050505');
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);

  // concentric snailing rings (sunburst texture)
  g.strokeStyle = 'rgba(255,255,255,0.035)';
  for (let r = 20; r < S * 0.5; r += 4) {
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
  }

  // outer minute track: 60 ticks, longer at 5-min marks
  g.strokeStyle = '#e9e4d2';
  g.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU;
    const isFive = i % 5 === 0;
    g.lineWidth = isFive ? 7 : 2.4;
    const r1 = S * 0.455, r2 = S * (isFive ? 0.405 : 0.435);
    g.beginPath();
    g.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
    g.lineTo(cx + Math.sin(a) * r2, cy - Math.cos(a) * r2);
    g.stroke();
  }

  // Roman numerals
  const numerals = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
  g.fillStyle = '#ece7d4';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 ${S * 0.072}px Georgia, "Times New Roman", serif`;
  numerals.forEach((n, i) => {
    const a = (i / 12) * TAU;
    const r = S * 0.345;
    const x = cx + Math.sin(a) * r;
    const y = cy - Math.cos(a) * r;
    g.fillText(n, x, y);
  });

  // brand + line of text
  g.font = `600 ${S * 0.038}px Georgia, serif`;
  g.fillStyle = '#d6d0b9';
  g.fillText('L E S T R A M K', cx, cy - S * 0.135);
  g.font = `500 ${S * 0.024}px Georgia, serif`;
  g.fillStyle = '#8f8a76';
  g.fillText('EST. 2025', cx, cy + S * 0.175);

  // subtle seconds subdial ring at 6 o'clock (decorative, unused)
  g.strokeStyle = 'rgba(233,228,210,0.28)';
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy + S * 0.26, S * 0.055, 0, TAU); g.stroke();
  g.fillStyle = '#c9c4b0';
  g.beginPath(); g.arc(cx, cy + S * 0.26, 3, 0, TAU); g.fill();

  // center pin base
  g.fillStyle = '#cfc9b2';
  g.beginPath(); g.arc(cx, cy, 8, 0, TAU); g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeLeatherTexture() {
  const W = 512, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // base leather
  g.fillStyle = '#181009';
  g.fillRect(0, 0, W, H);
  // grain noise
  for (let i = 0; i < 4200; i++) {
    const a = Math.random() * 0.09;
    g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(120,90,60,${a})`;
    g.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 3, 1 + Math.random() * 2);
  }
  // subtle pores
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.2})`;
    g.beginPath(); g.arc(Math.random() * W, Math.random() * H, 0.8 + Math.random(), 0, TAU); g.fill();
  }
  // saddle stitching along both long edges (tan dash)
  g.strokeStyle = '#8a6a45';
  g.lineWidth = 5;
  g.lineCap = 'round';
  g.setLineDash([14, 9]);
  g.beginPath(); g.moveTo(26, 12); g.lineTo(26, H - 12); g.stroke();
  g.beginPath(); g.moveTo(W - 26, 12); g.lineTo(W - 26, H - 12); g.stroke();
  g.setLineDash([]);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function dauphineHand(len, tail, width, mat, y) {
  const shape = new THREE.Shape();
  const w2 = width / 2;
  // tapered pointer: base wide, tip sharp — shape points toward +Y (maps to -Z = 12 o'clock after rotateX)
  shape.moveTo(0, -tail);
  shape.lineTo(-w2, len * 0.18);
  shape.lineTo(-w2 * 0.42, len * 0.72);
  shape.lineTo(0, len);
  shape.lineTo(w2 * 0.42, len * 0.72);
  shape.lineTo(w2, len * 0.18);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;      // lay flat, pointer toward -Z (12 o'clock)
  mesh.castShadow = true;
  const pivot = new THREE.Group();
  pivot.position.y = y;
  pivot.add(mesh);
  return pivot;
}

export function buildWatch(scene) {
  const watch = new THREE.Group();

  const steel = new THREE.MeshPhysicalMaterial({
    color: 0xd8d8d8, metalness: 1.0, roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.2,
  });
  const steelPolished = new THREE.MeshPhysicalMaterial({
    color: 0xe6e6e6, metalness: 1.0, roughness: 0.08,
  });
  const gold = new THREE.MeshPhysicalMaterial({
    color: 0xd4af37, metalness: 1.0, roughness: 0.18, clearcoat: 0.4,
  });
  const leatherTex = makeLeatherTexture();
  const leather = new THREE.MeshStandardMaterial({
    map: leatherTex, bumpMap: leatherTex, bumpScale: 0.6,
    color: 0xffffff, roughness: 0.88, metalness: 0.02,
  });

  const R = 1.05, H_CASE = 0.30;

  /* ---- case: lathe-turned steel ---- */
  const caseProfile = [
    [0.0, 0], [R * 0.82, 0], [R * 0.94, 0.02], [R, 0.075], [R, 0.20],
    [R * 0.96, 0.245], [R * 0.88, 0.285], [R * 0.72, 0.30], [0, 0.30],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const caseGeo = new THREE.LatheGeometry(caseProfile, 48);
  const caseMesh = new THREE.Mesh(caseGeo, steel);
  caseMesh.castShadow = caseMesh.receiveShadow = true;
  watch.add(caseMesh);

  /* ---- bezel: polished ring ---- */
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(R * 0.86, 0.075, 18, 48), steelPolished);
  bezel.rotation.x = Math.PI / 2;   // torus axis (local Z) points along world X? -> flatten along world Y via local Z scale
  bezel.position.y = 0.298;
  bezel.scale.set(1, 1, 0.55);      // local Z is world Y after rotateX(90°)
  bezel.castShadow = true;
  watch.add(bezel);

  /* ---- caseback lip detail ring (front face plate) ---- */
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.78, R * 0.78, 0.02, 48), steel);
  plate.position.y = 0.297;
  watch.add(plate);

  /* ---- dial ---- */
  const dial = new THREE.Mesh(
    new THREE.CircleGeometry(R * 0.74, 48),
    new THREE.MeshStandardMaterial({ map: makeDialTexture(), roughness: 0.55, metalness: 0.25 })
  );
  dial.rotation.x = -Math.PI / 2;
  dial.position.y = 0.31;
  watch.add(dial);

  /* ---- crystal: shallow dome (sphere cap around +Y by construction) ---- */
  const crystalGeo = new THREE.SphereGeometry(R * 0.76, 48, 12, 0, TAU, 0, Math.PI * 0.16);
  const crystal = new THREE.Mesh(
    crystalGeo,
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff, metalness: 0, roughness: 0.04, transparent: true,
      opacity: 0.16, clearcoat: 1, clearcoatRoughness: 0.06, depthWrite: false,
    })
  );
  crystal.position.y = 0.315;
  crystal.scale.set(1, 0.32, 1);   // flatten the dome vertically
  watch.add(crystal);

  /* ---- hands (pivot groups rotate about Y) ---- */
  const hourHand = dauphineHand(R * 0.40, R * 0.09, 0.085, gold, 0.335);
  const minHand = dauphineHand(R * 0.60, R * 0.09, 0.055, gold, 0.345);
  const secHand = dauphineHand(R * 0.62, R * 0.18, 0.016, gold, 0.355);
  // second-hand counterweight tail beyond the shape's tail
  const secDot = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.018, 16), gold);
  secDot.position.y = 0.356;
  // center cap
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.026, 24), gold);
  cap.position.y = 0.36;
  watch.add(hourHand, minHand, secHand, secDot, cap);

  /* ---- crown at 3 o'clock ---- */
  const crown = new THREE.Group();
  const crownBody = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.085, 20), steel);
  crownBody.rotation.z = Math.PI / 2;
  crownBody.castShadow = true;
  crown.add(crownBody);
  // thin accent ring on the crown
  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 8, 24), gold);
  crownRing.rotation.y = Math.PI / 2;
  crown.add(crownRing);
  const crownStem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.09, 12), steelPolished);
  crownStem.rotation.z = Math.PI / 2;
  crownStem.position.x = -0.09;
  crown.add(crownStem);
  crown.position.set(R + 0.085, 0.15, 0);
  watch.add(crown);

  /* ---- lugs ---- */
  const lugGeo = new THREE.BoxGeometry(0.22, 0.16, 0.34);
  for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const lug = new THREE.Mesh(lugGeo, steel);
    lug.position.set(sx * 0.33, 0.11, sz * (R - 0.02));
    lug.castShadow = true;
    watch.add(lug);
  }

  /* ---- strap (two ribbons fanning out, lying flat-ish with a bend) ---- */
  const strapShape = roundedRectShape(0.62, 2.5, 0.24);
  const strapGeo = new THREE.ExtrudeGeometry(strapShape, { depth: 0.075, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  strapGeo.rotateX(-Math.PI / 2); // lay flat, extends along -z / +z? extrude depth now +y
  const mkStrap = (sign, angle) => {
    const s = new THREE.Mesh(strapGeo, leather);
    s.castShadow = s.receiveShadow = true;
    s.position.set(0, 0.045, sign * (R + 0.98));
    s.rotation.y = angle;
    return s;
  };
  const strapNear = mkStrap(1, 0.22);
  const strapFar = mkStrap(-1, -0.18);
  // gentle bend: tip segments angled down
  const strapGeoTip = new THREE.ExtrudeGeometry(roundedRectShape(0.56, 1.15, 0.22), { depth: 0.075, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  strapGeoTip.rotateX(-Math.PI / 2);
  const tip = new THREE.Mesh(strapGeoTip, leather);
  tip.castShadow = true;
  tip.position.set(Math.sin(0.22) * 1.9, 0.01, Math.cos(0.22) * (R + 2.1));
  tip.rotation.y = 0.22;
  tip.rotation.x = 0.10;
  watch.add(strapNear, strapFar, tip);

  /* ---- buckle on far strap ---- */
  const buckle = new THREE.Group();
  const barMat = steelPolished;
  const bSide = new THREE.BoxGeometry(0.075, 0.09, 0.62);
  const bEnd = new THREE.BoxGeometry(0.5, 0.09, 0.075);
  buckle.add(new THREE.Mesh(bSide, barMat));
  const side2 = new THREE.Mesh(bSide, barMat); side2.position.x = 0.43; buckle.add(side2);
  const end1 = new THREE.Mesh(bEnd, barMat); end1.position.set(0.215, 0, 0.27); buckle.add(end1);
  const end2 = new THREE.Mesh(bEnd, barMat); end2.position.set(0.215, 0, -0.27); buckle.add(end2);
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.46, 10), gold);
  pin.rotation.z = Math.PI / 2; pin.position.set(0.215, 0.06, 0);
  buckle.add(pin);
  buckle.position.set(Math.sin(-0.18) * -2.2, 0.07, -(R + 2.35));
  buckle.rotation.y = -0.18;
  watch.add(buckle);

  /* ---- placement: lying flat at the foot of the board, face up ---- */
  watch.position.set(-2.55, -0.415, 5.5);
  watch.rotation.set(0, 0.55, 0);
  watch.scale.setScalar(0.68);
  scene.add(watch);

  /* ---- live time: sweep hands ---- */
  function updateWatch() {
    const now = new Date();
    const ms = now.getMilliseconds();
    const s = now.getSeconds() + ms / 1000;
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;
    secHand.rotation.y = -(s / 60) * TAU;
    minHand.rotation.y = -(m / 60) * TAU;
    hourHand.rotation.y = -(h / 12) * TAU;
  }
  updateWatch();
  return { updateWatch, group: watch };
}
