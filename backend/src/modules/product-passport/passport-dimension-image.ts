import sharp from 'sharp';

/** Поля листа САПР убираются только в печатной копии. Тёмные линии и подписи не обрезаем. */
export async function prepareDimensionImage(buf: Buffer): Promise<Buffer> {
  try {
    const base = await sharp(buf).flatten({ background: '#ffffff' }).trim({ background: '#ffffff', threshold: 24 }).png().toBuffer();
    const { data, info } = await sharp(base).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    // Inventor оставляет бледную границу бумаги по краям. Удаляем её, только если за ней
    // есть чистый промежуток, а в удаляемой полосе нет ни одного тёмного штриха.
    const edge = (vertical: boolean, reverse: boolean) => {
      const across = vertical ? width : height, along = vertical ? height : width;
      const band = Math.max(1, Math.floor(across * 0.01));
      const gap = Math.max(3, Math.ceil(across * 0.02));
      if (across <= 2 * (band + gap)) return 0;
      let line = false;
      for (let a = 0; a < band + gap; a++) {
        let ink = 0;
        for (let b = 0; b < along; b++) {
          const x = vertical ? (reverse ? width - 1 - a : a) : b;
          const y = vertical ? b : (reverse ? height - 1 - a : a);
          const value = data[y * width + x];
          if (value < 150) return 0;
          if (value < 240) ink++;
        }
        if (a < band) line ||= ink > along * 0.85;
        else if (ink) return 0;
      }
      return line ? band : 0;
    };
    const left = edge(true, false), right = edge(true, true);
    const top = edge(false, false), bottom = edge(false, true);
    let image = sharp(base);
    if (left || right || top || bottom) image = image.extract({ left, top, width: width - left - right, height: height - top - bottom });
    const cropped = await image.png().toBuffer();
    const trimmed = await sharp(cropped).trim({ background: '#ffffff', threshold: 24 }).png().toBuffer();
    const meta = await sharp(trimmed).metadata();
    const margin = Math.max(4, Math.ceil(Math.max(meta.width!, meta.height!) * 0.025));
    return await sharp(trimmed).extend({ top: margin, bottom: margin, left: margin, right: margin, background: '#ffffff' }).jpeg({ quality: 95 }).toBuffer();
  } catch { return buf; }
}
