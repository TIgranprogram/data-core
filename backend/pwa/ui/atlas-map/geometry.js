export function svg(tag, attrs = {}, ...children) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  element.append(...children);
  return element;
}

export function place(element, { x, y, w, h }) {
  element.style.setProperty('--am-x', x + 'px');
  element.style.setProperty('--am-y', y + 'px');
  element.style.setProperty('--am-w', w + 'px');
  element.style.setProperty('--am-h', h + 'px');
}

export function interpolate(a, b, progress) {
  const along = (key) => a[key] + (b[key] - a[key]) * progress;
  return { x: along('x'), y: along('y'), w: along('w'), h: along('h') };
}

export function span(cards, view) {
  const result = { minX: 0, minY: 0, maxX: view.w, maxY: view.h };
  for (const { box } of cards.values()) {
    result.minX = Math.min(result.minX, box.x - 24);
    result.minY = Math.min(result.minY, box.y - 24);
    result.maxX = Math.max(result.maxX, box.x + box.w + 24);
    result.maxY = Math.max(result.maxY, box.y + box.h + 24);
  }
  return result;
}

function side(box, edge, offset = 0) {
  if (edge === 'right') return { x: box.x + box.w + 4, y: box.y + box.h / 2 + offset };
  if (edge === 'left') return { x: box.x - 4, y: box.y + box.h / 2 + offset };
  return { x: box.x + box.w / 2 + offset, y: edge === 'top' ? box.y - 4 : box.y + box.h + 4 };
}

function curve(a, b, vertical) {
  if (vertical) {
    const lane = (a.y + b.y) / 2;
    return 'M' + a.x + ' ' + a.y + ' C' + a.x + ' ' + lane + ' ' + b.x + ' ' + lane + ' ' + b.x + ' ' + b.y;
  }
  const lane = (a.x + b.x) / 2;
  return 'M' + a.x + ' ' + a.y + ' C' + lane + ' ' + a.y + ' ' + lane + ' ' + b.y + ' ' + b.x + ' ' + b.y;
}

function outer(a, b, route, lane) {
  if (route === 'under') {
    const y = Math.max(a.y, b.y) + 58;
    const sign = Math.sign(b.x - a.x);
    return 'M' + a.x + ' ' + a.y + ' Q' + a.x + ' ' + y + ' ' + (a.x + sign * 38) + ' ' + y +
      ' H' + (b.x - sign * 38) + ' Q' + b.x + ' ' + y + ' ' + b.x + ' ' + b.y;
  }
  const sign = route === 'outer-left' ? -1 : 1;
  const x = a.x + sign * (25 + lane * 8);
  return 'M' + a.x + ' ' + a.y + ' C' + x + ' ' + a.y + ' ' + x + ' ' + b.y + ' ' + b.x + ' ' + b.y;
}

export function wireGeometry(from, to, wire) {
  const { route, fromPort = 0, toPort = 0, lane = 0 } = wire;
  const dx = to.x + to.w / 2 - from.x - from.w / 2;
  const dy = to.y + to.h / 2 - from.y - from.h / 2;
  if (route === 'branch' || route === 'trunk') {
    const top = side(from, 'bottom', fromPort);
    const base = { x: top.x, y: to.y + to.h / 2 };
    if (route === 'trunk') return { d: curve(top, base, true), origin: top, end: base };
    const end = side(to, to.x > top.x ? 'left' : 'right');
    return { d: curve(base, end, false), origin: base, end };
  }
  const vert = !route && Math.abs(dx) < 36 && Math.abs(dy) > 40;
  const outward = route === 'under' ? 'bottom' : route === 'outer-right' ? 'right' : route === 'outer-left' ? 'left' : null;
  const origin = side(from, outward || (vert ? dy > 0 ? 'bottom' : 'top' : dx > 0 ? 'right' : 'left'), fromPort);
  const end = side(to, outward || (vert ? dy > 0 ? 'top' : 'bottom' : dx > 0 ? 'left' : 'right'), toPort);
  const d = outward ? outer(origin, end, route, lane) : curve(origin, end, vert);
  return { d, origin, end };
}

export function applyView(element, canvas, pan, bounds) {
  const clamp = (current, min, max, available) => Math.min(-min, Math.max(available - max, current));
  pan.x = clamp(pan.x, bounds.minX, bounds.maxX, canvas.clientWidth);
  pan.y = clamp(pan.y, bounds.minY, bounds.maxY, canvas.clientHeight);
  element.style.setProperty('--am-pan-x', pan.x + 'px');
  element.style.setProperty('--am-pan-y', pan.y + 'px');
}

export function panInto(pan, box, canvas) {
  if (box.x + pan.x < 0 || box.x + pan.x + box.w > canvas.clientWidth) pan.x = canvas.clientWidth / 2 - box.x - box.w / 2;
  if (box.y + pan.y < 0 || box.y + pan.y + box.h > canvas.clientHeight) pan.y = canvas.clientHeight / 2 - box.y - box.h / 2;
}

export function bindAtlasDrag(canvas, onMove) {
  let drag = null;
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button, a')) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY };
    canvas.classList.add('is-dragging');
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    onMove(event.clientX - drag.x, event.clientY - drag.y);
    drag = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('lostpointercapture', () => { drag = null; canvas.classList.remove('is-dragging'); });
}
