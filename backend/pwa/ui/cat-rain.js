/**
 * Зелёные котики падают на фоне, как в «Матрице» (пользователь 2026-10-30): только у роли «Трубарез».
 * Котики разные и падают вразнобой. Холст под интерфейсом, клики не перехватывает; вкладка скрыта или в системе убрана анимация — не рисует.
 */
const FPS = 15, SPACE = 42, MIN_ALPHA = 0.1, MAX_ALPHA = 0.24;
let canvas = null, timer = 0, cats = [];

const earsHead = (c, r) => {
  c.beginPath();
  c.arc(0, 0, r, 0, Math.PI * 2);
  c.moveTo(-r, -r * 0.2); c.lineTo(-r * 0.85, -r * 1.5); c.lineTo(-r * 0.2, -r * 0.95);
  c.moveTo(r, -r * 0.2); c.lineTo(r * 0.85, -r * 1.5); c.lineTo(r * 0.2, -r * 0.95);
  c.fill();
};
const eyes = (c, r, y = 0) => {
  c.globalCompositeOperation = 'destination-out';
  c.beginPath(); c.arc(-r * 0.4, y, r * 0.17, 0, Math.PI * 2); c.arc(r * 0.4, y, r * 0.17, 0, Math.PI * 2); c.fill();
  c.globalCompositeOperation = 'source-over';
};
const tail = (c, x, y, r, bend) => {
  c.lineWidth = r * 0.32; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + r * 1.6, y + r * bend, x + r * 1.2, y - r * 1.4); c.stroke();
};
const KINDS = [
  (c, r) => { earsHead(c, r); eyes(c, r); }, // мордочка
  (c, r) => { // сидит
    c.beginPath(); c.ellipse(0, r * 1.1, r * 0.9, r * 1.2, 0, 0, Math.PI * 2); c.fill();
    c.save(); c.translate(0, -r * 0.5); earsHead(c, r * 0.72); eyes(c, r * 0.72); c.restore();
    tail(c, r * 0.7, r * 1.9, r, 0.6);
  },
  (c, r) => { // лежит, вытянулся
    c.beginPath(); c.ellipse(0, 0, r * 1.6, r * 0.75, 0, 0, Math.PI * 2); c.fill();
    c.save(); c.translate(-r * 1.4, -r * 0.45); earsHead(c, r * 0.68); eyes(c, r * 0.68); c.restore();
    tail(c, r * 1.4, 0, r, -0.8);
  },
  (c, r) => { // лапка
    c.beginPath(); c.ellipse(0, r * 0.3, r * 0.75, r * 0.6, 0, 0, Math.PI * 2); c.fill();
    for (const [x, y] of [[-r * 0.8, -r * 0.35], [-r * 0.28, -r * 0.8], [r * 0.28, -r * 0.8], [r * 0.8, -r * 0.35]]) { c.beginPath(); c.arc(x, y, r * 0.27, 0, Math.PI * 2); c.fill(); }
  },
];

const rnd = (a, b) => a + Math.random() * (b - a);
function spawn(onScreen) {
  return {
    x: rnd(0, canvas.width), y: onScreen ? rnd(0, canvas.height) : rnd(-160, -30), draw: KINDS[Math.floor(Math.random() * KINDS.length)],
    r: rnd(9, 16), speed: rnd(0.5, 2.2), alpha: rnd(MIN_ALPHA, MAX_ALPHA), angle: rnd(0, Math.PI * 2), turn: rnd(-0.03, 0.03), sway: rnd(0, 1.4), phase: rnd(0, 6), wave: rnd(0.02, 0.06),
  };
}

function layout() {
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  cats = Array.from({ length: Math.ceil(canvas.width / SPACE) }, () => spawn(true));
}

function frame() {
  if (document.hidden) return;
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, canvas.width, canvas.height);
  const color = getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#0f7d55';
  cats.forEach((k, i) => {
    c.save();
    c.globalAlpha = k.alpha; c.fillStyle = color; c.strokeStyle = color;
    c.translate(k.x + Math.sin(k.y * k.wave + k.phase) * k.sway * 10, k.y);
    c.rotate(k.angle);
    k.draw(c, k.r);
    c.restore();
    k.y += k.speed; k.angle += k.turn;
    if (k.y > canvas.height + 40) cats[i] = spawn(false);
  });
}

export function startCats() {
  if (canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  canvas = document.createElement('canvas');
  canvas.className = 'cat-rain';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  layout();
  window.addEventListener('resize', layout);
  timer = setInterval(frame, 1000 / FPS);
}

export function stopCats() {
  if (!canvas) return;
  clearInterval(timer);
  window.removeEventListener('resize', layout);
  canvas.remove();
  canvas = null;
}
