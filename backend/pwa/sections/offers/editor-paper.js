import { h } from '../../core/dom.js';

// Печатный лист и его интерактивные области используют одни координаты.
export function offerPaper(onError, paintSurface) {
  const overlay = h('div', { class: 'offer-sheet-tools', 'aria-label': 'Правка на листе' });
  const sheet = h('div', { class: 'offer-sheet' }, overlay);
  const stage = h('main', { class: 'bk-scroll offer-stage', tabindex: 0, 'aria-label': 'Страницы печатного КП' }, sheet);
  let document, pending, rendering, props, fileToken = 0, paintToken = 0, current = 1, mode = 'width';
  let paintKey = '';
  function stopDrawing() {
    paintToken++;
    rendering?.cancel();
    rendering = null;
  }
  function updateSurface() {
    if (props) paintSurface(overlay, props);
  }
  async function draw(number = current, zoom = mode) {
    current = number; mode = zoom;
    if (!document || !stage.isConnected) return;
    const key = [fileToken, number, zoom, stage.clientWidth, stage.clientHeight, window.devicePixelRatio].join('/');
    if (key === paintKey) return;
    paintKey = key;
    stopDrawing();
    const token = paintToken;
    try {
      const page = await document.getPage(number);
      if (token !== paintToken) return;
      const original = page.getViewport({ scale: 1 });
      const width = (stage.clientWidth - 32) / original.width;
      const fit = Math.min(width, (stage.clientHeight - 24) / original.height);
      // 2 CSS-пикселя на пункт PDF соответствуют 150 % физического размера A4 при 96 dpi.
      const scale = zoom === 'large' ? Math.max(2, width * 1.4) : zoom === 'fit' ? fit : Math.min(1.6, width);
      const viewport = page.getViewport({ scale: Math.max(0.1, scale) });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = h('canvas', { class: 'offer-paper', width: Math.ceil(viewport.width * ratio), height: Math.ceil(viewport.height * ratio),
        role: 'img', 'aria-label': 'Лист ' + number });
      rendering = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await rendering.promise;
      if (token !== paintToken) return;
      sheet.style.setProperty('--offer-paper-width', viewport.width + 'px');
      sheet.querySelector('canvas')?.remove();
      sheet.prepend(canvas);
      if (props?.page !== number) stage.scrollTo(0, 0);
      props = { width: original.width, height: original.height, page: number, fileToken };
      updateSurface();
    } catch (e) {
      if (token === paintToken && e.name !== 'RenderingCancelledException') { paintKey = ''; onError(e); }
    }
  }
  const observer = new ResizeObserver(() => draw());
  observer.observe(stage);
  async function load(blob) {
    const token = ++fileToken;
    stopDrawing();
    const old = pending;
    pending = null; document = null;
    if (old) await old.destroy();
    const [pdfjs, data] = await Promise.all([import('../../vendor/pdfjs-6.5.438/pdf.min.mjs'), blob.arrayBuffer()]);
    if (token !== fileToken) return;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs-6.5.438/pdf.worker.min.mjs', import.meta.url).href;
    pending = pdfjs.getDocument({ data, useWasm: false, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
    const loaded = await pending.promise;
    if (token === fileToken) document = loaded;
  }
  function close() {
    observer.disconnect(); fileToken++; stopDrawing(); void pending?.destroy(); document = null;
  }
  return { stage, draw, load, close, updateSurface };
}
