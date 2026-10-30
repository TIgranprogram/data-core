/**
 * Зелёные котики и собачки падают на фоне, как в «Матрице» (пользователь 2026-10-30): котики — у роли «Трубарез», собачки — у «Лазер лист».
 * Пасхалка: после 16:00 у котиков и собачек глаза горят красным и мерцают, как звёзды.
 * Фигурка рисуется один раз на отдельном холсте и дальше только копируется: так глаза вырезаются чисто, а кадр лёгкий.
 * Холст под интерфейсом, клики не перехватывает; вкладка скрыта или в системе убрана анимация — не рисует.
 */
const FPS = 15, SPACE = 46, MIN_ALPHA = 0.14, MAX_ALPHA = 0.3;
const CELL = 180, UNIT = 42; // размер заготовки и радиус фигурки в ней, px
let canvas = null, timer = 0, falling = [], sprites = [], spritesFor = '', kinds = [], eyes = [], spark = null, tick = 0;

const cut = (c, draw) => { c.globalCompositeOperation = 'destination-out'; draw(); c.globalCompositeOperation = 'source-over'; };
const dot = (c, x, y, rx, ry = rx, a = 0) => { c.beginPath(); c.ellipse(x, y, rx, ry, a, 0, Math.PI * 2); c.fill(); };
const line = (c, w, pts) => { c.lineWidth = w; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath(); c.moveTo(...pts[0]); for (const p of pts.slice(1)) c.lineTo(...p); c.stroke(); };

function catHead(c, r) {
  c.beginPath();
  c.moveTo(-r, r * 0.05);
  c.quadraticCurveTo(-r * 1.08, -r * 0.7, -r * 0.88, -r * 1.4);
  c.quadraticCurveTo(-r * 0.58, -r * 1.02, -r * 0.3, -r * 0.86);
  c.quadraticCurveTo(0, -r * 0.96, r * 0.3, -r * 0.86);
  c.quadraticCurveTo(r * 0.58, -r * 1.02, r * 0.88, -r * 1.4);
  c.quadraticCurveTo(r * 1.08, -r * 0.7, r, r * 0.05);
  c.quadraticCurveTo(r * 0.92, r * 0.92, 0, r * 0.96);
  c.quadraticCurveTo(-r * 0.92, r * 0.92, -r, r * 0.05);
  c.fill();
  cut(c, () => {
    for (const s of [-1, 1]) dot(c, s * r * 0.42, -r * 0.08, r * 0.2, r * 0.13, s * -0.3); // глаза
    c.beginPath(); c.moveTo(-r * 0.09, r * 0.24); c.lineTo(r * 0.09, r * 0.24); c.lineTo(0, r * 0.36); c.fill(); // нос
    for (const s of [-1, 1]) line(c, r * 0.05, [[0, r * 0.36], [s * r * 0.18, r * 0.5]]);
  });
  for (const s of [-1, 1]) for (const k of [-0.12, 0.1]) line(c, r * 0.05, [[s * r * 0.95, r * 0.3], [s * r * 1.5, r * (0.3 + k)]]); // усы
}

function dogHead(c, r) {
  dot(c, 0, 0, r * 0.95, r);
  for (const s of [-1, 1]) dot(c, s * r * 1.02, r * 0.18, r * 0.36, r * 0.9, s * -0.2); // висячие уши
  dot(c, 0, r * 0.6, r * 0.6, r * 0.46);
  cut(c, () => {
    for (const s of [-1, 1]) dot(c, s * r * 0.4, -r * 0.2, r * 0.15);
    dot(c, 0, r * 0.38, r * 0.2, r * 0.14); // нос
    line(c, r * 0.05, [[0, r * 0.5], [0, r * 0.72]]);
    for (const s of [-1, 1]) line(c, r * 0.05, [[0, r * 0.72], [s * r * 0.26, r * 0.82]]);
  });
}

function sittingBody(c, r) {
  c.beginPath();
  c.moveTo(-r * 0.5, -r * 0.2);
  c.bezierCurveTo(-r * 1.25, r * 0.7, -r * 1.1, r * 2, -r * 0.55, r * 2);
  c.lineTo(r * 0.6, r * 2);
  c.bezierCurveTo(r * 1.15, r * 2, r * 1.2, r * 0.7, r * 0.5, -r * 0.2);
  c.closePath(); c.fill();
  cut(c, () => line(c, r * 0.06, [[0, r * 1.1], [0, r * 2]])); // передние лапы
}

const paw = (c, r) => {
  dot(c, 0, r * 0.3, r * 0.78, r * 0.62);
  for (const [x, y] of [[-r * 0.85, -r * 0.3], [-r * 0.3, -r * 0.8], [r * 0.3, -r * 0.8], [r * 0.85, -r * 0.3]]) dot(c, x, y, r * 0.27, r * 0.33);
};

const CATS = [
  (c, r) => catHead(c, r),
  (c, r) => { // сидит, хвост обвивает лапы
    c.save(); c.translate(0, -r * 0.55); sittingBody(c, r * 0.8);
    c.restore();
    line(c, r * 0.22, [[r * 0.55, r * 0.95], [r * 1.15, r * 0.9], [r * 1.3, r * 0.35]]);
    c.save(); c.translate(0, -r * 0.95); catHead(c, r * 0.68); c.restore();
  },
  (c, r) => { // лежит и вытянулся
    dot(c, r * 0.3, r * 0.2, r * 1.35, r * 0.68);
    line(c, r * 0.22, [[r * 1.5, r * 0.3], [r * 1.95, r * 0.1], [r * 1.85, -r * 0.45]]);
    c.save(); c.translate(-r * 1.05, -r * 0.2); catHead(c, r * 0.68); c.restore();
  },
  paw,
];

const DOGS = [
  (c, r) => dogHead(c, r),
  (c, r) => { // сидит, хвост вверх
    c.save(); c.translate(0, -r * 0.55); sittingBody(c, r * 0.8);
    c.restore();
    line(c, r * 0.24, [[r * 0.6, r * 0.9], [r * 1.2, r * 0.6], [r * 1.35, r * 0.05]]);
    c.save(); c.translate(0, -r * 0.95); dogHead(c, r * 0.68); c.restore();
  },
  (c, r) => { // косточка
    line(c, r * 0.56, [[-r, 0], [r, 0]]);
    for (const [x, y] of [[-r * 1.25, -r * 0.36], [-r * 1.25, r * 0.36], [r * 1.25, -r * 0.36], [r * 1.25, r * 0.36]]) dot(c, x, y, r * 0.42);
  },
  paw,
];
const SETS = { cats: CATS, dogs: DOGS };
/** Где глаза у каждой фигурки, в радиусах от центра: как в рисунках выше. */
const EYES = {
  cats: [[[-0.42, -0.08], [0.42, -0.08]], [[-0.29, -1], [0.29, -1]], [[-1.34, -0.25], [-0.76, -0.25]], []],
  dogs: [[[-0.4, -0.2], [0.4, -0.2]], [[-0.27, -1.09], [0.27, -1.09]], [], []],
};
const EVENING = 16;

/** Искра глаза: мягкое красное свечение, яркая середина и тонкая четырёхлучевая звезда. */
function makeSpark() {
  const s = document.createElement('canvas');
  s.width = s.height = 128;
  const c = s.getContext('2d');
  c.translate(64, 64);
  const halo = c.createRadialGradient(0, 0, 2, 0, 0, 44);
  halo.addColorStop(0, 'rgba(255,60,40,.95)'); halo.addColorStop(0.35, 'rgba(255,30,20,.45)'); halo.addColorStop(1, 'rgba(255,0,0,0)');
  c.fillStyle = halo; c.beginPath(); c.arc(0, 0, 44, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgba(255,120,95,.95)';
  for (let i = 0; i < 4; i++) {
    c.rotate(Math.PI / 2);
    c.beginPath(); c.moveTo(-4, 0); c.quadraticCurveTo(-0.6, -8, 0, -62); c.quadraticCurveTo(0.6, -8, 4, 0); c.fill();
  }
  const core = c.createRadialGradient(0, 0, 0, 0, 0, 9);
  core.addColorStop(0, 'rgba(255,250,235,1)'); core.addColorStop(1, 'rgba(255,90,60,0)');
  c.fillStyle = core; c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.fill();
  return s;
}

/** Заготовки фигурок: цвет темы меняется — перерисовываются. */
function prepare(color) {
  if (spritesFor === color) return;
  spritesFor = color;
  sprites = kinds.map((draw) => {
    const s = document.createElement('canvas');
    s.width = s.height = CELL;
    const c = s.getContext('2d');
    c.fillStyle = color; c.strokeStyle = color;
    c.translate(CELL / 2, CELL / 2);
    draw(c, UNIT);
    return s;
  });
}

const rnd = (a, b) => a + Math.random() * (b - a);
function spawn(onScreen) {
  const h = window.innerHeight;
  return {
    x: rnd(0, window.innerWidth), y: onScreen ? rnd(0, h) : rnd(-160, -40), sprite: Math.floor(Math.random() * kinds.length),
    r: rnd(11, 18), speed: rnd(0.5, 2.2), alpha: rnd(MIN_ALPHA, MAX_ALPHA), tilt: rnd(-0.35, 0.35), sway: rnd(0, 1.4), phase: rnd(0, 6), wave: rnd(0.02, 0.05),
  };
}

function layout() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr; canvas.height = window.innerHeight * dpr;
  canvas.style.width = '100vw'; canvas.style.height = '100vh';
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  falling = Array.from({ length: Math.ceil(window.innerWidth / SPACE) }, () => spawn(true));
}

function frame() {
  if (document.hidden) return;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, window.innerWidth, window.innerHeight);
  const glow = new Date().getHours() >= EVENING;
  tick++;
  prepare(getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#0f7d55');
  falling.forEach((k, i) => {
    const size = (k.r / UNIT) * CELL;
    c.save();
    c.globalAlpha = k.alpha;
    c.translate(k.x + Math.sin(k.y * k.wave + k.phase) * k.sway * 10, k.y);
    c.rotate(k.tilt + Math.sin(k.y * k.wave) * 0.12);
    c.drawImage(sprites[k.sprite], -size / 2, -size / 2, size, size);
    if (glow) {
      (eyes[k.sprite] || []).forEach(([x, y], n) => {
        const beat = Math.sin(tick * 0.3 + k.phase * 3 + n * 1.7); // у каждого глаза свой ритм, как у звёзд
        const r = k.r * (1.15 + beat * 0.35);
        c.globalAlpha = 0.65 + beat * 0.35;
        c.drawImage(spark, x * k.r - r / 2, y * k.r - r / 2, r, r);
      });
    }
    c.restore();
    k.y += k.speed;
    if (k.y > window.innerHeight + 40) falling[i] = spawn(false);
  });
}

/** set: 'cats' | 'dogs'. */
export function startRain(set) {
  if (canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  kinds = SETS[set];
  eyes = EYES[set];
  spark ||= makeSpark();
  spritesFor = '';
  canvas = document.createElement('canvas');
  canvas.className = 'cat-rain';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  layout();
  window.addEventListener('resize', layout);
  timer = setInterval(frame, 1000 / FPS);
}

export function stopRain() {
  if (!canvas) return;
  clearInterval(timer);
  window.removeEventListener('resize', layout);
  canvas.remove();
  canvas = null;
}
