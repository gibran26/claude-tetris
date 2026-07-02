'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

// --- Power-up: Bomba ---
const BOMB_TYPE = 8;
const BOMB_SPAWN_LINES = 2; // líneas eliminadas entre cada aparición de la Bomba
const BOMB_BLAST_RADIUS = 1; // 1 = área de 3x3 (radio alrededor del centro)
PIECES.push([[BOMB_TYPE]]);

const GRID_COLORS = {
  dark: '#22222e',
  light: '#d8d8e4',
};

// --- Skins visuales ---
// Cada paleta tiene 9 posiciones: índice 0 = null, 1-7 = tipos de pieza, 8 = bomba.
const SKIN_PALETTES = {
  retro: [
    null,
    '#4dd0e1', // I - cyan
    '#ffd54f', // O - yellow
    '#ba68c8', // T - purple
    '#81c784', // S - green
    '#e57373', // Z - red
    '#64b5f6', // J - pale blue
    '#ffb74d', // L - orange
    '#212121', // bomba
  ],
  neon: [
    null,
    '#00e5ff',
    '#faff00',
    '#e040fb',
    '#39ff14',
    '#ff1744',
    '#2979ff',
    '#ff6d00',
    '#ff3d00', // bomba
  ],
  pastel: [
    null,
    '#a8d8ea',
    '#fff1a8',
    '#d8b4e2',
    '#b8e0b0',
    '#f4a9a8',
    '#a8c5e8',
    '#f5c99b',
    '#c9a8d8', // bomba
  ],
  pixel: [
    null,
    '#4dd0e1',
    '#ffd54f',
    '#ba68c8',
    '#81c784',
    '#e57373',
    '#64b5f6',
    '#ffb74d',
    '#212121', // bomba
  ],
};
const VALID_SKINS = Object.keys(SKIN_PALETTES);
const SKIN_STORAGE_KEY = 'tetris-skin';

function loadSkin() {
  try {
    const stored = localStorage.getItem(SKIN_STORAGE_KEY);
    if (stored && VALID_SKINS.includes(stored)) return stored;
  } catch (e) {
    // localStorage no disponible (modo privado, etc.) — se usa el valor por defecto
  }
  return 'retro';
}

function saveSkin(value) {
  try {
    localStorage.setItem(SKIN_STORAGE_KEY, value);
  } catch (e) {
    // ignorar si localStorage no está disponible
  }
}

function currentPalette() {
  return SKIN_PALETTES[skin] || SKIN_PALETTES.retro;
}

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const skinSelect = document.getElementById('skin-select');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let linesSinceBomb, bombPending;
let theme = 'dark';
let skin = loadSkin();

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function createPiece(type, shape) {
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return createPiece(type, shape);
}

function createBombPiece() {
  return createPiece(BOMB_TYPE, [[BOMB_TYPE]]);
}

function nextPiece() {
  if (bombPending) {
    bombPending = false;
    return createBombPiece();
  }
  return randomPiece();
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    linesSinceBomb += cleared;
    if (linesSinceBomb >= BOMB_SPAWN_LINES) {
      linesSinceBomb = 0;
      bombPending = true;
    }
    updateHUD();
  }
}

function explodeBomb(cx, cy) {
  for (let r = cy - BOMB_BLAST_RADIUS; r <= cy + BOMB_BLAST_RADIUS; r++) {
    for (let c = cx - BOMB_BLAST_RADIUS; c <= cx + BOMB_BLAST_RADIUS; c++) {
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
      board[r][c] = 0;
    }
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  if (current.type === BOMB_TYPE) {
    explodeBomb(current.x, current.y);
  }
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = nextPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  if (colorIndex === BOMB_TYPE) {
    drawBombBlock(context, x, y, size, alpha);
    return;
  }
  switch (skin) {
    case 'neon':
      drawBlockNeon(context, x, y, colorIndex, size, alpha);
      break;
    case 'pastel':
      drawBlockPastel(context, x, y, colorIndex, size, alpha);
      break;
    case 'pixel':
      drawBlockPixel(context, x, y, colorIndex, size, alpha);
      break;
    default:
      drawBlockRetro(context, x, y, colorIndex, size, alpha);
      break;
  }
}

function drawBlockRetro(context, x, y, colorIndex, size, alpha) {
  const color = currentPalette()[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawBlockNeon(context, x, y, colorIndex, size, alpha) {
  const color = currentPalette()[colorIndex];
  const px = x * size + 2, py = y * size + 2, s = size - 4;
  context.globalAlpha = alpha ?? 1;
  context.save();
  context.shadowBlur = 10;
  context.shadowColor = color;
  context.fillStyle = 'rgba(10,10,20,0.85)';
  context.fillRect(px, py, s, s);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.strokeRect(px, py, s, s);
  context.restore();
  context.globalAlpha = 1;
}

function drawBlockPastel(context, x, y, colorIndex, size, alpha) {
  const color = currentPalette()[colorIndex];
  const px = x * size + 2, py = y * size + 2, w = size - 4, h = size - 4;
  const radius = Math.min(6, w / 2, h / 2);
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.beginPath();
  if (typeof context.roundRect === 'function') {
    context.roundRect(px, py, w, h, radius);
  } else {
    context.moveTo(px + radius, py);
    context.arcTo(px + w, py, px + w, py + h, radius);
    context.arcTo(px + w, py + h, px, py + h, radius);
    context.arcTo(px, py + h, px, py, radius);
    context.arcTo(px, py, px + w, py, radius);
    context.closePath();
  }
  context.fill();
  context.globalAlpha = 1;
}

function drawBlockPixel(context, x, y, colorIndex, size, alpha) {
  const color = currentPalette()[colorIndex];
  const px = x * size + 1, py = y * size + 1, s = size - 2;
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(px, py, s, s);
  // patrón de dithering: cuadrícula fina en tablero de ajedrez
  const cell = Math.max(2, Math.floor(s / 6));
  context.fillStyle = 'rgba(0,0,0,0.18)';
  for (let gy = 0; gy < s; gy += cell) {
    for (let gx = ((gy / cell) % 2 === 0) ? 0 : cell; gx < s; gx += cell * 2) {
      context.fillRect(px + gx, py + gy, cell, cell);
    }
  }
  context.strokeStyle = 'rgba(0,0,0,0.35)';
  context.lineWidth = 1;
  context.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
  context.globalAlpha = 1;
}

function drawBombBlock(context, x, y, size, alpha) {
  const cx = x * size + size / 2;
  const cy = y * size + size / 2;
  const bombColor = currentPalette()[BOMB_TYPE];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = bombColor;
  context.beginPath();
  context.arc(cx, cy, size / 2 - 3, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#ff5252';
  context.lineWidth = 2;
  context.stroke();
  context.strokeStyle = '#ffeb3b';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(cx - size / 5, cy - size / 5);
  context.lineTo(cx + size / 5, cy + size / 5);
  context.moveTo(cx + size / 5, cy - size / 5);
  context.lineTo(cx - size / 5, cy + size / 5);
  context.stroke();
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = GRID_COLORS[theme];
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  if (gameOver) return;
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  linesSinceBomb = 0;
  bombPending = false;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

themeToggle.addEventListener('change', () => {
  theme = themeToggle.checked ? 'light' : 'dark';
  document.body.dataset.theme = theme;
});

skinSelect.value = skin;
skinSelect.addEventListener('change', () => {
  skin = VALID_SKINS.includes(skinSelect.value) ? skinSelect.value : 'retro';
  saveSkin(skin);
  draw();
  drawNext();
});

init();
