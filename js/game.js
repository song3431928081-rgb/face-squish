/* ============================================================
   Face Squish — Pixar Character Deformation Game
   3 Modes: Free Style / Challenge / Character Remix
   Soft physics mesh + affine warp + particles + audio
   ============================================================ */

'use strict';

/* ================================================================
   CONFIG & CHARACTER DATA
   ================================================================ */
const CONFIG = {
  GRID_W: 14,          // fewer cells = larger triangles = more dramatic warp
  GRID_H: 14,
  SPRING: 0.03,        // very weak spring = deformation persists before slowly recovering
  DAMP: 0.95,          // high damp = wobbles more before settling
  RADIUS: 160,         // large grab radius = bigger area deformed at once
  BG: '#0a0e27',
  MAX_PARTICLES: 120,
  CROP_LEFT: 0.08,
  CROP_TOP: 0.06,
  CROP_RIGHT: 0.18,
  CROP_BOTTOM: 0.18,
  DRAG_MULTIPLIER: 4.0,
};

const CHARACTERS = [
  { name: 'Anton Ego',   img: 'images/anton_ego.jpg',   trait: 'Long nose, sleepy eyes' },
  { name: 'Remy',        img: 'images/remy.jpg',         trait: 'Whiskers, big ears' },
  { name: 'Linguini',    img: 'images/linguini.jpg',      trait: 'Curly hair, nervous' },
  { name: 'Woody',       img: 'images/woody.jpg',         trait: 'Cowboy hat, warm smile' },
  { name: 'Buzz Lightyear', img: 'images/buzz_lightyear.jpg', trait: 'Helmet, strong jaw' },
];

const CHALLENGES = [
  { char: 0, text: 'Bend Anton\'s long nose sideways!',  area: { x: 0.5, y: 0.45, r: 0.15 }, threshold: 120, time: 30 },
  { char: 1, text: 'Stretch Remy\'s whiskers wide!',      area: { x: 0.5, y: 0.5,  r: 0.2  }, threshold: 100, time: 30 },
  { char: 3, text: 'Pull Woody\'s hat up high!',           area: { x: 0.5, y: 0.15, r: 0.15 }, threshold: 100, time: 30 },
  { char: 4, text: 'Squish Buzz\'s jaw flat!',             area: { x: 0.5, y: 0.75, r: 0.15 }, threshold: 90,  time: 30 },
  { char: 2, text: 'Make Linguini\'s cheeks puffy!',       area: { x: 0.5, y: 0.6,  r: 0.2  }, threshold: 90,  time: 30 },
  { char: 0, text: 'Make Anton Ego look surprised!',       area: { x: 0.5, y: 0.4,  r: 0.25 }, threshold: 110, time: 30 },
  { char: 1, text: 'Blow up Remy\'s nose like a balloon!', area: { x: 0.5, y: 0.5,  r: 0.12 }, threshold: 100, time: 30 },
  { char: 4, text: 'Make Buzz look totally silly!',        area: { x: 0.5, y: 0.5,  r: 0.3  }, threshold: 130, time: 35 },
];

/* ================================================================
   GLOBAL STATE
   ================================================================ */
let canvas, ctx;
let imgObj = null;
let imgObj2 = null;          // second image for remix mode
let texW = 0, texH = 0;
let cellW = 0, cellH = 0;
let vertices = [];
let cols, rows;
let currentChar = 0;
let remixTopChar = 0, remixBottomChar = 1;

let dragging = false;
let dragStartX = 0, dragStartY = 0;
let pointer = { x: 0, y: 0 };

let audioCtx = null;
let particles = [];
let ripples = [];
let screenShake = 0;
let distortLevel = 0;

// Game state
let gameState = {
  mode: 'menu',       // 'menu' | 'free' | 'challenge' | 'remix'
  score: 0,
  totalScore: 0,
  challengeIdx: 0,
  challengeActive: false,
  challengeTimer: 0,
  challengeStartTime: 0,
  challengeCompleted: false,
  remixUnlocked: false,
};

// Load saved state
function loadSavedState() {
  try {
    const saved = localStorage.getItem('faceSquishState');
    if (saved) {
      const s = JSON.parse(saved);
      gameState.totalScore = s.totalScore || 0;
      gameState.remixUnlocked = s.remixUnlocked || false;
    }
  } catch(e) {}
}
function saveState() {
  try {
    localStorage.setItem('faceSquishState', JSON.stringify({
      totalScore: gameState.totalScore,
      remixUnlocked: gameState.remixUnlocked,
    }));
  } catch(e) {}
}

/* ================================================================
   AFFINE TRANSFORM SOLVER
   ================================================================ */
function solveAffine(src, dst) {
  const x1=src[0][0], y1=src[0][1];
  const x2=src[1][0], y2=src[1][1];
  const x3=src[2][0], y3=src[2][1];
  const A = [[x1,y1,1],[x2,y2,1],[x3,y3,1]];
  const det = A[0][0]*(A[1][1]*A[2][2]-A[1][2]*A[2][1])
            - A[0][1]*(A[1][0]*A[2][2]-A[1][2]*A[2][0])
            + A[0][2]*(A[1][0]*A[2][1]-A[1][1]*A[2][0]);
  if (Math.abs(det) < 1e-8) return null;
  const inv = [
    [ (A[1][1]*A[2][2]-A[1][2]*A[2][1])/det, -(A[0][1]*A[2][2]-A[0][2]*A[2][1])/det,  (A[0][1]*A[1][2]-A[0][2]*A[1][1])/det ],
    [-(A[1][0]*A[2][2]-A[1][2]*A[2][0])/det,  (A[0][0]*A[2][2]-A[0][2]*A[2][0])/det, -(A[0][0]*A[1][2]-A[0][2]*A[1][0])/det ],
    [ (A[1][0]*A[2][1]-A[1][1]*A[2][0])/det, -(A[0][0]*A[2][1]-A[0][1]*A[2][0])/det,  (A[0][0]*A[1][1]-A[0][1]*A[1][0])/det ],
  ];
  const dx = dst.map(p => p[0]);
  const dy = dst.map(p => p[1]);
  const a = inv[0][0]*dx[0] + inv[0][1]*dx[1] + inv[0][2]*dx[2];
  const c = inv[1][0]*dx[0] + inv[1][1]*dx[1] + inv[1][2]*dx[2];
  const e = inv[2][0]*dx[0] + inv[2][1]*dx[1] + inv[2][2]*dx[2];
  const b = inv[0][0]*dy[0] + inv[0][1]*dy[1] + inv[0][2]*dy[2];
  const d = inv[1][0]*dy[0] + inv[1][1]*dy[1] + inv[1][2]*dy[2];
  const f = inv[2][0]*dy[0] + inv[2][1]*dy[1] + inv[2][2]*dy[2];
  return [a, b, c, d, e, f];
}

/* ================================================================
   VERTEX MESH
   ================================================================ */
function buildGrid() {
  cols = CONFIG.GRID_W + 1;
  rows = CONFIG.GRID_H + 1;
  vertices = [];
  for (let j = 0; j < rows; j++) {
    const row = [];
    for (let i = 0; i < cols; i++) {
      const hx = i * cellW;
      const hy = j * cellH;
      row.push({ homeX: hx, homeY: hy, x: hx, y: hy, vx: 0, vy: 0, fixed: false, _anchorX: 0, _anchorY: 0, _weight: 0 });
    }
    vertices.push(row);
  }
}

function resetVertices() {
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      v.x = v.homeX; v.y = v.homeY; v.vx = 0; v.vy = 0; v.fixed = false;
    }
  }
}

function updatePhysics() {
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      if (v.fixed) continue;
      v.vx += (v.homeX - v.x) * CONFIG.SPRING;
      v.vy += (v.homeY - v.y) * CONFIG.SPRING;
      v.vx *= CONFIG.DAMP;
      v.vy *= CONFIG.DAMP;
      v.x += v.vx;
      v.y += v.vy;
    }
  }
}

/* ================================================================
   RENDERING
   ================================================================ */
function render() {
  if (!imgObj || imgObj.complete === false) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = CONFIG.BG;
  ctx.fillRect(0, 0, W, H);

  // Apply screen shake offset
  let shakeX = 0, shakeY = 0;
  if (screenShake > 0) {
    shakeX = (Math.random() - 0.5) * screenShake;
    shakeY = (Math.random() - 0.5) * screenShake;
    screenShake *= 0.85;
    if (screenShake < 0.5) screenShake = 0;
  }
  ctx.save();
  ctx.translate(shakeX, shakeY);

  // Draw mesh triangles
  // Source coords must be in texture space (0..texW, 0..texH)
  // Destination coords are in canvas space (vertex positions)
  const texScaleX = texW / canvas.width;
  const texScaleY = texH / canvas.height;
  for (let j = 0; j < CONFIG.GRID_H; j++) {
    for (let i = 0; i < CONFIG.GRID_W; i++) {
      const sx0 = i * cellW * texScaleX,   sy0 = j * cellH * texScaleY;
      const sx1 = (i+1)*cellW * texScaleX,  sy1 = j * cellH * texScaleY;
      const sx2 = (i+1)*cellW * texScaleX,  sy2 = (j+1)*cellH * texScaleY;
      const sx3 = i * cellW * texScaleX,    sy3 = (j+1)*cellH * texScaleY;

      const p0 = vertices[j][i];
      const p1 = vertices[j][i+1];
      const p2 = vertices[j+1][i+1];
      const p3 = vertices[j+1][i];

      // Remix mode: top half uses imgObj, bottom half uses imgObj2
      const isTopHalf = (j < CONFIG.GRID_H / 2);
      const useImg = (gameState.mode === 'remix' && imgObj2 && !isTopHalf) ? imgObj2 : imgObj;
      const useTexW = (gameState.mode === 'remix' && imgObj2 && !isTopHalf) ? imgObj2.naturalWidth : texW;
      const useTexH = (gameState.mode === 'remix' && imgObj2 && !isTopHalf) ? imgObj2.naturalHeight : texH;

      drawTri(useImg, useTexW, useTexH,
        [[sx0,sy0],[sx1,sy1],[sx2,sy2]],
        [[p0.x,p0.y],[p1.x,p1.y],[p2.x,p2.y]]
      );
      drawTri(useImg, useTexW, useTexH,
        [[sx0,sy0],[sx2,sy2],[sx3,sy3]],
        [[p0.x,p0.y],[p2.x,p2.y],[p3.x,p3.y]]
      );
    }
  }

  // Draw particles on top
  renderParticles();

  ctx.restore();
}

function drawTri(img, tw, th, srcPts, dstPts) {
  const M = solveAffine(srcPts, dstPts);
  if (!M) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dstPts[0][0], dstPts[0][1]);
  ctx.lineTo(dstPts[1][0], dstPts[1][1]);
  ctx.lineTo(dstPts[2][0], dstPts[2][1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(M[0], M[1], M[2], M[3], M[4], M[5]);
  // Asymmetric crop to remove "AI生成" watermark in bottom-right
  const sx = tw * CONFIG.CROP_LEFT;
  const sy = th * CONFIG.CROP_TOP;
  const sw = tw * (1 - CONFIG.CROP_LEFT - CONFIG.CROP_RIGHT);
  const sh = th * (1 - CONFIG.CROP_TOP - CONFIG.CROP_BOTTOM);
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, tw, th);
  ctx.restore();
}

/* ================================================================
   PARTICLES
   ================================================================ */
function spawnParticles(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    if (particles.length >= CONFIG.MAX_PARTICLES) break;
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.0,
      size: 2 + Math.random() * 4,
      color: color || `hsl(${Math.random()*60+30}, 100%, 65%)`,
    });
  }
}

function renderParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.15; // gravity
    p.vx *= 0.96;
    p.life -= 0.025;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ================================================================
   RIPPLE EFFECT (CSS-based)
   ================================================================ */
function spawnRipple(clientX, clientY) {
  const layer = document.getElementById('rippleLayer');
  const rect = layer.getBoundingClientRect();
  const r = document.createElement('div');
  r.className = 'ripple';
  r.style.left = (clientX - rect.left) + 'px';
  r.style.top = (clientY - rect.top) + 'px';
  layer.appendChild(r);
  setTimeout(() => r.remove(), 600);
}

/* ================================================================
   SCREEN SHAKE & DISTORTION
   ================================================================ */
function triggerShake(intensity) {
  screenShake = Math.max(screenShake, intensity);
}

function checkExtremeDeformation() {
  let totalDisp = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      const dx = v.x - v.homeX, dy = v.y - v.homeY;
      totalDisp += Math.sqrt(dx*dx + dy*dy);
    }
  }
  const avgDisp = totalDisp / (rows * cols);
  if (avgDisp > 15) {
    distortLevel = Math.min(1, (avgDisp - 15) / 25);
    document.getElementById('canvasWrap').classList.add('distort');
    if (avgDisp > 30 && Math.random() < 0.08) {
      playSound('extreme');
      triggerShake(5);
    }
  } else {
    distortLevel = 0;
    document.getElementById('canvasWrap').classList.remove('distort');
  }
}

/* ================================================================
   SCORING SYSTEM
   ================================================================ */
function calculateDeformationScore() {
  let totalDisp = 0;
  let maxDisp = 0;
  let leftDisp = 0, rightDisp = 0;

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      const dx = v.x - v.homeX, dy = v.y - v.homeY;
      const d = Math.sqrt(dx*dx + dy*dy);
      totalDisp += d;
      if (d > maxDisp) maxDisp = d;
      if (i < cols / 2) leftDisp += d;
      else rightDisp += d;
    }
  }

  const avgDisp = totalDisp / (rows * cols);
  // Creativity: how much total deformation
  const creativity = Math.min(100, avgDisp * 3);
  // Funny: asymmetry between left and right
  const asymmetry = Math.abs(leftDisp - rightDisp) / (totalDisp + 1);
  const funny = Math.min(100, asymmetry * 200 + maxDisp * 0.5);
  // Combined score
  const score = Math.round(creativity * 0.5 + funny * 0.5);
  return { creativity: Math.round(creativity), funny: Math.round(funny), score, avgDisp };
}

function updateScoreDisplay() {
  const s = calculateDeformationScore();
  gameState.score = s.score;
  document.getElementById('scoreValue').textContent = s.score;
}

/* ================================================================
   CHALLENGE MODE
   ================================================================ */
function startChallenge(idx) {
  gameState.challengeIdx = idx;
  const ch = CHALLENGES[idx % CHALLENGES.length];
  gameState.challengeActive = true;
  gameState.challengeCompleted = false;
  gameState.challengeStartTime = Date.now();
  gameState.challengeTimer = ch.time;

  // Load the character
  currentChar = ch.char;
  loadChar(ch.char, () => {
    updateCharSelectUI();
  });

  // Show task banner
  const banner = document.getElementById('taskBanner');
  banner.classList.remove('hidden');
  document.getElementById('taskText').textContent = ch.text;
  document.getElementById('modeLabel').textContent = 'Challenge';
}

function updateChallengeTimer() {
  if (!gameState.challengeActive) return;
  const ch = CHALLENGES[gameState.challengeIdx % CHALLENGES.length];
  const elapsed = (Date.now() - gameState.challengeStartTime) / 1000;
  const remaining = Math.max(0, ch.time - elapsed);
  gameState.challengeTimer = remaining;

  const pct = (remaining / ch.time) * 100;
  document.getElementById('timerBar').style.width = pct + '%';
  document.getElementById('timerText').textContent = Math.ceil(remaining) + 's';

  // Check if challenge area is sufficiently deformed
  if (!gameState.challengeCompleted) {
    const areaDisp = getAreaDeformation(ch.area);
    if (areaDisp > ch.threshold) {
      completeChallenge(true, remaining);
    }
  }

  if (remaining <= 0 && !gameState.challengeCompleted) {
    completeChallenge(false, 0);
  }
}

function getAreaDeformation(area) {
  const cx = area.x * canvas.width;
  const cy = area.y * canvas.height;
  const r = area.r * canvas.width;
  let totalDisp = 0;
  let count = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      const dx = v.homeX - cx, dy = v.homeY - cy;
      if (dx*dx + dy*dy > r*r) continue;
      const ddx = v.x - v.homeX, ddy = v.y - v.homeY;
      totalDisp += Math.sqrt(ddx*ddx + ddy*ddy);
      count++;
    }
  }
  return count > 0 ? totalDisp / count * 3 : 0;
}

function completeChallenge(success, timeLeft) {
  gameState.challengeCompleted = true;
  gameState.challengeActive = false;
  document.getElementById('taskBanner').classList.add('hidden');

  const ch = CHALLENGES[gameState.challengeIdx % CHALLENGES.length];
  let score, stars, title, detail;

  if (success) {
    const speedBonus = Math.round(timeLeft * 5);
    const deformScore = calculateDeformationScore().score;
    score = deformScore + speedBonus + 200;
    stars = score > 400 ? '⭐⭐⭐' : score > 250 ? '⭐⭐' : '⭐';
    title = 'Challenge Complete!';
    detail = `Speed bonus: +${speedBonus}. Great job!`;
    playSound('success');
  } else {
    score = Math.round(calculateDeformationScore().score * 0.3);
    stars = '☆';
    title = 'Time\'s Up!';
    detail = 'Try again for a better score!';
    playSound('fail');
  }

  gameState.totalScore += score;
  // Unlock remix after completing 3 challenges
  if (gameState.totalScore > 500) {
    gameState.remixUnlocked = true;
  }
  saveState();
  updateMenuStats();

  showResultModal(title, score, stars, detail);
}

function showResultModal(title, score, stars, detail) {
  document.getElementById('resultTitle').textContent = title;
  document.getElementById('resultScore').textContent = score;
  document.getElementById('resultStars').textContent = stars;
  document.getElementById('resultDetail').textContent = detail;
  document.getElementById('resultModal').classList.remove('hidden');
}

/* ================================================================
   INTERACTION
   ================================================================ */
function screenToTexture(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  const x = (sx - rect.left) / rect.width * canvas.width;
  const y = (sy - rect.top) / rect.height * canvas.height;
  return { x, y };
}

function onPointerDown(e) {
  e.preventDefault();
  if (!imgObj) return;
  const p = getPointerPos(e);
  const t = screenToTexture(p.x, p.y);
  pointer.x = t.x; pointer.y = t.y;
  dragStartX = t.x; dragStartY = t.y;
  dragging = true;

  // Ripple effect at touch point
  spawnRipple(p.x, p.y);

  // Find vertices in radius and fix them
  const r2 = CONFIG.RADIUS * CONFIG.RADIUS;
  let hitCount = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      const dx = v.homeX - t.x, dy = v.homeY - t.y;
      const d2 = dx*dx + dy*dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2);
      const w = 1 - d / CONFIG.RADIUS;
      v.fixed = true;
      v._anchorX = v.x;
      v._anchorY = v.y;
      v._weight = w * w;
      hitCount++;
    }
  }

  if (hitCount > 0) {
    playSound('touch');
    triggerShake(2);
    // Spawn a few particles
    spawnParticles(t.x, t.y, 5);
  }
  unlockAudio();
}

function onPointerMove(e) {
  e.preventDefault();
  if (!dragging) return;
  const p = getPointerPos(e);
  const t = screenToTexture(p.x, p.y);
  pointer.x = t.x; pointer.y = t.y;

  const deltaX = t.x - dragStartX;
  const deltaY = t.y - dragStartY;

  let hasFixed = false;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      if (vertices[j][i].fixed) { hasFixed = true; break; }
    }
    if (hasFixed) break;
  }

  if (hasFixed) {
    const mult = CONFIG.DRAG_MULTIPLIER;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const v = vertices[j][i];
        if (!v.fixed) continue;
        // Amplify drag displacement for extreme stretch effect
        v.x = v._anchorX + deltaX * v._weight * mult;
        v.y = v._anchorY + deltaY * v._weight * mult;
      }
    }
    // Spawn particles while dragging
    if (Math.abs(deltaX) + Math.abs(deltaY) > 20 && Math.random() < 0.4) {
      spawnParticles(t.x, t.y, 3);
    }
  } else {
    applyInfluence(t.x, t.y, 8);
  }
}

function onPointerUp(e) {
  e.preventDefault();
  dragging = false;
  let anyMoved = false;
  let maxDisp = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      if (!v.fixed) continue;
      v.fixed = false;
      const dx = v.homeX - v.x;
      const dy = v.homeY - v.y;
      const disp = Math.sqrt(dx*dx + dy*dy);
      if (disp > maxDisp) maxDisp = disp;
      // Strong snap-back velocity for exaggerated wobble
      v.vx = dx * 1.8;
      v.vy = dy * 1.8;
      if (disp > 2) anyMoved = true;
    }
  }
  if (anyMoved) {
    playSound('release');
    // Bigger deformation = more violent shake + particle burst
    if (maxDisp > 50) {
      triggerShake(7);
      spawnParticles(pointer.x, pointer.y, 20);
    } else if (maxDisp > 25) {
      triggerShake(4);
      spawnParticles(pointer.x, pointer.y, 10);
    }
  }
}

function applyInfluence(tx, ty, strength) {
  const r2 = CONFIG.RADIUS * CONFIG.RADIUS;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      if (v.fixed) continue;
      const dx = v.x - tx, dy = v.y - ty;
      const d2 = dx*dx + dy*dy;
      if (d2 > r2) continue;
      const d = Math.sqrt(d2) + 0.001;
      const w = 1 - d / CONFIG.RADIUS;
      const push = w * w;
      v.vx += dx / d * strength * push;
      v.vy += dy / d * strength * push;
    }
  }
}

function getPointerPos(e) {
  if (e.touches && e.touches.length) {
    return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  if (e.changedTouches && e.changedTouches.length) {
    return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  }
  return { x: e.clientX, y: e.clientY };
}

/* ================================================================
   BUTTON ACTIONS
   ================================================================ */
function randomSquish() {
  playSound('fun');
  triggerShake(8);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      // Direct displacement for instant extreme chaos
      v.x += (Math.random() - 0.5) * 120;
      v.y += (Math.random() - 0.5) * 120;
      v.vx = (Math.random() - 0.5) * 40;
      v.vy = (Math.random() - 0.5) * 40;
    }
  }
  const cx = canvas.width / 2, cy = canvas.height / 2;
  spawnParticles(cx, cy, 30);
}

function resetAll() {
  playSound('reset');
  resetVertices();
  particles = [];
  document.getElementById('canvasWrap').classList.remove('distort');
}

function squash() {
  playSound('fun');
  triggerShake(6);
  const cx = canvas.width / 2, cy = canvas.height / 2;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      const dx = cx - v.x, dy = cy - v.y;
      // Direct displacement: squeeze toward center horizontally, flatten vertically
      v.x += dx * 0.5;
      v.y += dy * 0.1; // minimal vertical = face gets squished flat
    }
  }
  spawnParticles(cx, cy, 15);
}

function stretch() {
  playSound('fun');
  triggerShake(6);
  const cx = canvas.width / 2, cy = canvas.height / 2;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = vertices[j][i];
      const dx = v.x - cx, dy = v.y - cy;
      const d = Math.sqrt(dx*dx + dy*dy) + 1;
      // Direct displacement: push outward strongly
      v.x += dx / d * 80;
      v.y += dy / d * 80;
    }
  }
  spawnParticles(cx, cy, 15);
}

/* ================================================================
   WEB AUDIO
   ================================================================ */
function initAudio() {
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch(e) { audioCtx = null; }
}
function unlockAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function playSound(type) {
  if (!audioCtx) return;
  unlockAudio();
  const t = audioCtx.currentTime;

  if (type === 'touch') {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'sine'; o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(800, t + 0.06);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    o.start(t); o.stop(t + 0.1);
  } else if (type === 'release') {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'triangle'; o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(400, t + 0.15);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.start(t); o.stop(t + 0.2);
  } else if (type === 'fun') {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(600, t + 0.2);
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.start(t); o.stop(t + 0.3);
  } else if (type === 'reset') {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'sine'; o.frequency.setValueAtTime(100, t);
    o.frequency.linearRampToValueAtTime(800, t + 0.25);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.start(t); o.stop(t + 0.35);
  } else if (type === 'success') {
    // Happy chord arpeggio
    const freqs = [523, 659, 784, 1047];
    freqs.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'triangle'; o.frequency.setValueAtTime(f, t + i * 0.08);
      g.gain.setValueAtTime(0.0, t + i * 0.08);
      g.gain.linearRampToValueAtTime(0.12, t + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.08 + 0.3);
      o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.35);
    });
  } else if (type === 'fail') {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(100, t + 0.4);
    g.gain.setValueAtTime(0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.start(t); o.stop(t + 0.5);
  } else if (type === 'extreme') {
    // Funny wobbling sound
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = 'square'; o.frequency.setValueAtTime(150, t);
    o.frequency.linearRampToValueAtTime(400, t + 0.1);
    o.frequency.linearRampToValueAtTime(100, t + 0.2);
    g.gain.setValueAtTime(0.06, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.start(t); o.stop(t + 0.3);
  }
}

/* ================================================================
   IMAGE LOADING
   ================================================================ */
function loadChar(idx, callback) {
  currentChar = idx;
  const c = CHARACTERS[idx];
  showLoading(true);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    imgObj = img;
    texW = img.naturalWidth;
    texH = img.naturalHeight;
    // Cap canvas resolution for performance and to make forces proportional
    const size = 512;
    canvas.width = size;
    canvas.height = size;
    cellW = size / CONFIG.GRID_W;
    cellH = size / CONFIG.GRID_H;
    buildGrid();
    showLoading(false);
    document.getElementById('charNameDisplay').textContent = c.name;
    if (callback) callback();
  };
  img.onerror = () => {
    console.error('Failed to load:', c.img);
    showLoading(false);
  };
  img.src = c.img;
}

function loadRemixChars(topIdx, bottomIdx) {
  remixTopChar = topIdx;
  remixBottomChar = bottomIdx;
  showLoading(true);

  let loaded = 0;
  const total = 2;
  const onLoaded = () => {
    loaded++;
    if (loaded === total) {
      const size = 512;
      canvas.width = size;
      canvas.height = size;
      cellW = size / CONFIG.GRID_W;
      cellH = size / CONFIG.GRID_H;
      buildGrid();
      showLoading(false);
      document.getElementById('charNameDisplay').textContent =
        CHARACTERS[topIdx].name + ' + ' + CHARACTERS[bottomIdx].name;
    }
  };

  const img1 = new Image();
  img1.onload = () => { imgObj = img1; texW = img1.naturalWidth; texH = img1.naturalHeight; onLoaded(); };
  img1.src = CHARACTERS[topIdx].img;

  const img2 = new Image();
  img2.onload = () => { imgObj2 = img2; onLoaded(); };
  img2.src = CHARACTERS[bottomIdx].img;
}

function showLoading(yes) {
  document.getElementById('loading').classList.toggle('hidden', !yes);
}

/* ================================================================
   UI BUILDING
   ================================================================ */
function buildCharSelect() {
  const sel = document.getElementById('charSelect');
  sel.innerHTML = '';
  CHARACTERS.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'char-thumb' + (i === currentChar ? ' active' : '');
    div.innerHTML = `<img src="${c.img}" alt="${c.name}">`;
    div.addEventListener('click', () => {
      document.querySelectorAll('.char-thumb').forEach(el => el.classList.remove('active'));
      div.classList.add('active');
      if (gameState.mode === 'remix') return; // use remix selectors instead
      loadChar(i);
      playSound('touch');
    });
    sel.appendChild(div);
  });
}

function updateCharSelectUI() {
  document.querySelectorAll('#charSelect .char-thumb').forEach((el, i) => {
    el.classList.toggle('active', i === currentChar);
  });
}

function buildRemixSelect() {
  const topThumbs = document.getElementById('remixTopThumbs');
  const botThumbs = document.getElementById('remixBottomThumbs');
  topThumbs.innerHTML = '';
  botThumbs.innerHTML = '';
  CHARACTERS.forEach((c, i) => {
    const t = document.createElement('div');
    t.className = 'remix-thumb' + (i === remixTopChar ? ' active' : '');
    t.innerHTML = `<img src="${c.img}" alt="${c.name}">`;
    t.addEventListener('click', () => {
      topThumbs.querySelectorAll('.remix-thumb').forEach(el => el.classList.remove('active'));
      t.classList.add('active');
      loadRemixChars(i, remixBottomChar);
      playSound('touch');
    });
    topThumbs.appendChild(t);

    const b = document.createElement('div');
    b.className = 'remix-thumb' + (i === remixBottomChar ? ' active' : '');
    b.innerHTML = `<img src="${c.img}" alt="${c.name}">`;
    b.addEventListener('click', () => {
      botThumbs.querySelectorAll('.remix-thumb').forEach(el => el.classList.remove('active'));
      b.classList.add('active');
      loadRemixChars(remixTopChar, i);
      playSound('touch');
    });
    botThumbs.appendChild(b);
  });
}

function buildMenuBgParticles() {
  const bg = document.getElementById('menuBg');
  for (let i = 0; i < 20; i++) {
    const dot = document.createElement('div');
    dot.className = 'bg-dot';
    dot.style.left = Math.random() * 100 + '%';
    dot.style.animationDuration = (8 + Math.random() * 12) + 's';
    dot.style.animationDelay = -Math.random() * 15 + 's';
    dot.style.opacity = 0.2 + Math.random() * 0.3;
    bg.appendChild(dot);
  }
}

function updateMenuStats() {
  document.getElementById('totalScoreDisplay').textContent = gameState.totalScore;
  const remixBadge = document.getElementById('badgeRemix');
  if (gameState.remixUnlocked) {
    remixBadge.textContent = 'UNLOCKED';
    remixBadge.classList.remove('locked');
  } else {
    remixBadge.textContent = 'LOCKED';
    remixBadge.classList.add('locked');
  }
}

/* ================================================================
   SCREEN MANAGEMENT
   ================================================================ */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  if (name === 'menu') {
    document.getElementById('screenMenu').classList.add('active');
    updateMenuStats();
  } else {
    document.getElementById('screenGame').classList.add('active');
  }
}

function startMode(mode) {
  gameState.mode = mode;
  gameState.score = 0;
  gameState.challengeActive = false;
  gameState.challengeCompleted = false;

  // Show/hide UI elements based on mode
  const charSelect = document.getElementById('charSelect');
  const remixSelect = document.getElementById('remixSelect');
  const taskBanner = document.getElementById('taskBanner');

  charSelect.classList.remove('hidden');
  remixSelect.classList.add('hidden');
  taskBanner.classList.add('hidden');

  if (mode === 'free') {
    document.getElementById('modeLabel').textContent = 'Free Style';
    currentChar = 0;
    loadChar(0, () => { buildCharSelect(); });
  } else if (mode === 'challenge') {
    charSelect.classList.add('hidden');
    document.getElementById('modeLabel').textContent = 'Challenge';
    startChallenge(gameState.challengeIdx);
  } else if (mode === 'remix') {
    if (!gameState.remixUnlocked) {
      // Allow it anyway but show a note
      gameState.remixUnlocked = true;
      updateMenuStats();
    }
    charSelect.classList.add('hidden');
    remixSelect.classList.remove('hidden');
    document.getElementById('modeLabel').textContent = 'Remix';
    loadRemixChars(remixTopChar, remixBottomChar);
  }

  showScreen('game');
}

/* ================================================================
   MAIN LOOP
   ================================================================ */
function loop() {
  updatePhysics();
  render();
  checkExtremeDeformation();

  if (gameState.mode === 'challenge' && gameState.challengeActive) {
    updateChallengeTimer();
  }

  // Update score display periodically (every ~6 frames)
  if (Math.floor(Date.now() / 100) % 6 === 0) {
    if (gameState.mode === 'free' || gameState.mode === 'remix') {
      updateScoreDisplay();
    }
  }

  requestAnimationFrame(loop);
}

/* ================================================================
   INIT
   ================================================================ */
function init() {
  canvas = document.getElementById('gameCanvas');
  ctx = canvas.getContext('2d');

  loadSavedState();
  initAudio();
  buildMenuBgParticles();
  buildCharSelect();
  buildRemixSelect();
  updateMenuStats();

  // Menu mode cards
  document.querySelectorAll('.mode-card').forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode;
      if (mode === 'remix' && !gameState.remixUnlocked) {
        // Unlock anyway for demo, but show message
        gameState.remixUnlocked = true;
        updateMenuStats();
      }
      startMode(mode);
      playSound('touch');
      unlockAudio();
    });
  });

  // Back button
  document.getElementById('btnBack').addEventListener('click', () => {
    gameState.challengeActive = false;
    document.getElementById('taskBanner').classList.add('hidden');
    document.getElementById('resultModal').classList.add('hidden');
    showScreen('menu');
    updateMenuStats();
    playSound('touch');
  });

  // Canvas events
  canvas.addEventListener('mousedown', onPointerDown);
  canvas.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  canvas.addEventListener('touchmove', onPointerMove, { passive: false });
  canvas.addEventListener('touchend', onPointerUp, { passive: false });
  canvas.addEventListener('touchcancel', onPointerUp, { passive: false });

  // Buttons
  document.getElementById('btnRandom').addEventListener('click', randomSquish);
  document.getElementById('btnReset').addEventListener('click', resetAll);
  document.getElementById('btnSquash').addEventListener('click', squash);
  document.getElementById('btnStretch').addEventListener('click', stretch);

  // Modal buttons
  document.getElementById('btnRetry').addEventListener('click', () => {
    document.getElementById('resultModal').classList.add('hidden');
    startChallenge(gameState.challengeIdx);
  });
  document.getElementById('btnNext').addEventListener('click', () => {
    document.getElementById('resultModal').classList.add('hidden');
    gameState.challengeIdx++;
    startChallenge(gameState.challengeIdx);
  });

  // Load default character for when user enters free mode
  loadChar(0);

  requestAnimationFrame(loop);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
