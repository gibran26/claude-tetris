'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#64b5f6', // J - pale blue
  '#ffb74d', // L - orange
];

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
COLORS.push('#212121');
PIECES.push([[BOMB_TYPE]]);

const GRID_COLORS = {
  dark: '#22222e',
  light: '#d8d8e4',
};

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
const overlayStatsEl = document.getElementById('overlay-stats');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');

const bestComboValueEl = document.getElementById('best-combo-value');
const bestLinesValueEl = document.getElementById('best-lines-value');
const highscoreListEl = document.getElementById('highscore-list');
const resetScoresBtn = document.getElementById('reset-scores-btn');
const highscoreEntryEl = document.getElementById('highscore-entry');
const playerNameInput = document.getElementById('player-name-input');
const saveScoreBtn = document.getElementById('save-score-btn');
const overlayHighscoresEl = document.getElementById('overlay-highscores');
const overlayHighscoreListEl = document.getElementById('overlay-highscore-list');
const resetScoresBtnOverlay = document.getElementById('reset-scores-btn-overlay');

// --- Persistencia: records locales ---
// Top 5 de puntuaciones: [{ name: string, score: number }, ...] ordenado desc.
const HIGHSCORES_KEY = 'tetris-highscores';
// Mejor combo y líneas máximas conseguidas alguna vez: { bestCombo: number, bestLines: number }
const STATS_KEY = 'tetris-stats';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let linesSinceBomb, bombPending;
let theme = 'dark';
let comboCount, maxComboThisGame;
let bestCombo, bestLines;
let highScores = [];
let saveScoreHandler = null;

// --- Records: lectura/escritura defensiva de localStorage ---

function loadHighScores() {
  try {
    const raw = localStorage.getItem(HIGHSCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(entry => entry && typeof entry.name === 'string' && typeof entry.score === 'number')
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  } catch (e) {
    return [];
  }
}

function saveHighScores(list) {
  try {
    localStorage.setItem(HIGHSCORES_KEY, JSON.stringify(list));
  } catch (e) {
    // localStorage no disponible (modo privado, cuota excedida, etc.); se ignora.
  }
}

function loadStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { bestCombo: 0, bestLines: 0 };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { bestCombo: 0, bestLines: 0 };
    return {
      bestCombo: typeof parsed.bestCombo === 'number' ? parsed.bestCombo : 0,
      bestLines: typeof parsed.bestLines === 'number' ? parsed.bestLines : 0,
    };
  } catch (e) {
    return { bestCombo: 0, bestLines: 0 };
  }
}

function saveStats(stats) {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    // localStorage no disponible; se ignora.
  }
}

function qualifiesForHighScore(candidateScore) {
  if (candidateScore <= 0) return false;
  if (highScores.length < 5) return true;
  return candidateScore > highScores[highScores.length - 1].score;
}

// Inserta la puntuación, reordena, recorta a 5 y persiste.
// Devuelve el índice donde quedó insertada (o -1 si no entró en el top 5).
function addHighScore(name, entryScore) {
  highScores.push({ name, score: entryScore });
  highScores.sort((a, b) => b.score - a.score);
  highScores = highScores.slice(0, 5);
  saveHighScores(highScores);
  return highScores.findIndex(e => e.name === name && e.score === entryScore);
}

function resetHighScores() {
  highScores = [];
  saveHighScores(highScores);
  renderHighScoreTable(highscoreListEl, -1);
  renderHighScoreTable(overlayHighscoreListEl, -1);
}

function renderHighScoreTable(listEl, highlightIndex) {
  listEl.innerHTML = '';
  if (highScores.length === 0) {
    const li = document.createElement('li');
    li.className = 'highscore-empty';
    li.textContent = 'Sin récords todavía';
    listEl.appendChild(li);
    return;
  }
  highScores.forEach((entry, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${entry.name} — ${entry.score.toLocaleString()}`;
    if (i === highlightIndex) li.classList.add('highscore-current');
    listEl.appendChild(li);
  });
}

function renderStatsPanel() {
  bestComboValueEl.textContent = bestCombo;
  bestLinesValueEl.textContent = bestLines;
}

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
    comboCount++;
    if (comboCount > maxComboThisGame) maxComboThisGame = comboCount;
    updateHUD();
  }
  return cleared;
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
  const cleared = clearLines();
  if (cleared === 0) comboCount = 0;
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
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawBombBlock(context, x, y, size, alpha) {
  const cx = x * size + size / 2;
  const cy = y * size + size / 2;
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = COLORS[BOMB_TYPE];
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

  // Actualiza y persiste records de combo/líneas.
  if (maxComboThisGame > bestCombo) bestCombo = maxComboThisGame;
  if (lines > bestLines) bestLines = lines;
  saveStats({ bestCombo, bestLines });
  renderStatsPanel();
  overlayStatsEl.textContent =
    `Combo máx.: ${maxComboThisGame} (récord: ${bestCombo}) · Líneas: ${lines} (récord: ${bestLines})`;

  // Quita cualquier listener de guardado de una partida anterior sin confirmar.
  if (saveScoreHandler) {
    saveScoreBtn.removeEventListener('click', saveScoreHandler);
    saveScoreHandler = null;
  }

  overlayHighscoresEl.classList.remove('hidden');
  renderHighScoreTable(overlayHighscoreListEl, -1);

  if (qualifiesForHighScore(score)) {
    highscoreEntryEl.classList.remove('hidden');
    playerNameInput.value = '';
    saveScoreHandler = () => {
      const name = playerNameInput.value.trim().slice(0, 12) || 'Jugador';
      const idx = addHighScore(name, score);
      renderHighScoreTable(overlayHighscoreListEl, idx);
      renderHighScoreTable(highscoreListEl, -1);
      highscoreEntryEl.classList.add('hidden');
      saveScoreBtn.removeEventListener('click', saveScoreHandler);
      saveScoreHandler = null;
    };
    saveScoreBtn.addEventListener('click', saveScoreHandler);
    playerNameInput.focus();
  } else {
    highscoreEntryEl.classList.add('hidden');
  }

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
    overlayStatsEl.textContent = '';
    highscoreEntryEl.classList.add('hidden');
    overlayHighscoresEl.classList.add('hidden');
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
  comboCount = 0;
  maxComboThisGame = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  renderStatsPanel();
  renderHighScoreTable(highscoreListEl, -1);
  highscoreEntryEl.classList.add('hidden');
  overlayHighscoresEl.classList.add('hidden');
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

resetScoresBtn.addEventListener('click', resetHighScores);
resetScoresBtnOverlay.addEventListener('click', resetHighScores);

playerNameInput.addEventListener('keydown', e => {
  if (e.code === 'Enter') saveScoreBtn.click();
});

// Carga inicial de records persistidos (una sola vez, no se recarga en cada init()).
highScores = loadHighScores();
const initialStats = loadStats();
bestCombo = initialStats.bestCombo;
bestLines = initialStats.bestLines;

init();
