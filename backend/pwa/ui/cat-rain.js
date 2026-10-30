/**
 * Зелёные котики падают на фоне, как в «Матрице» (пользователь 2026-10-30): только у роли «Трубарез».
 * Холст под интерфейсом, клики не перехватывает; вкладка скрыта или в системе убрана анимация — не рисует.
 */
const FPS = 15, GAP = 64, TAIL = 5, STEP = 30, MAX_ALPHA = 0.16;
let canvas = null, timer = 0, columns = [];

function cat(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.moveTo(x - r, y - r * 0.2); ctx.lineTo(x - r * 0.85, y - r * 1.5); ctx.lineTo(x - r * 0.2, y - r * 0.95);
  ctx.moveTo(x + r, y - r * 0.2); ctx.lineTo(x + r * 0.85, y - r * 1.5); ctx.lineTo(x + r * 0.2, y - r * 0.95);
  ctx.fill();
}

function layout() {
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  columns = Array.from({ length: Math.ceil(canvas.width / GAP) }, (_, i) => ({
    x: i * GAP + GAP / 2, y: Math.random() * canvas.height, speed: 0.5 + Math.random(), r: 5 + Math.random() * 3,
  }));
}

function frame() {
  if (document.hidden) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--primary').trim() || '#0f7d55';
  for (const c of columns) {
    for (let i = 0; i < TAIL; i++) {
      ctx.globalAlpha = MAX_ALPHA * (1 - i / TAIL);
      cat(ctx, c.x, c.y - i * STEP, c.r);
    }
    c.y += c.speed;
    if (c.y - TAIL * STEP > canvas.height) c.y = -Math.random() * canvas.height / 2;
  }
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
