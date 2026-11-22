import { h } from '../../core/dom.js';

// Сервер уже сформировал листы: здесь только отрисовка выбранной страницы готового PDF.
export function offerPaper(onError) {
  const stage = h('main', { class: 'bk-scroll offer-stage', tabindex: 0, 'aria-label': 'Страницы печатного КП' });
  let document, pending, rendering, fileToken = 0, paintToken = 0, current = 1, enlarged = false;
  let paintKey = '';
  function stopDrawing() {
    paintToken++;
    rendering?.cancel();
    rendering = null;
  }
  async function draw(number = current, zoom = enlarged) {
    current = number; enlarged = zoom;
    if (!document || !stage.isConnected) return;
    const key = [fileToken, number, enlarged, stage.clientWidth, stage.clientHeight, window.devicePixelRatio].join('/');
    if (key === paintKey) return;
    paintKey = key;
    stopDrawing();
    const token = paintToken;
    try {
      const page = await document.getPage(number);
      if (token !== paintToken) return;
      const original = page.getViewport({ scale: 1 });
      const fit = Math.min((stage.clientWidth - 32) / original.width, (stage.clientHeight - 24) / original.height);
      // 2 CSS-пикселя на пункт PDF соответствуют 150 % физического размера A4 при 96 dpi.
      const scale = enlarged ? Math.max(2, fit * 1.5) : fit;
      const viewport = page.getViewport({ scale: Math.max(0.1, scale) });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const canvas = h('canvas', { class: 'offer-paper', width: Math.ceil(viewport.width * ratio), height: Math.ceil(viewport.height * ratio),
        role: 'img', 'aria-label': 'Лист ' + number });
      canvas.style.setProperty('--offer-paper-width', viewport.width + 'px');
      rendering = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      await rendering.promise;
      if (token !== paintToken) return;
      stage.replaceChildren(canvas);
      stage.scrollTo(0, 0);
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
  return { stage, draw, load, close };
}
