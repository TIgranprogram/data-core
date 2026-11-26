import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REVIEWS = 'tools/atlas-code-reviewed.json';
const sha256 = input => createHash('sha256').update(input).digest('hex');

/** Отпечаток путей и текущего содержимого кода отдельно для каждого блока. */
export function atlasCodeHashes(root, nodes) {
  if (nodes.length === 0) return {};
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--',
    ...new Set(nodes.flatMap(node => node.code))], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr.trim() || 'git ls-files завершился ошибкой');

  const files = new Map();
  for (const file of [...new Set(result.stdout.split('\0').filter(Boolean))].sort()) {
    let content;
    try {
      content = fs.readFileSync(path.join(root, file));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    // Git хранит текст с LF, но Windows может выдавать CRLF. Двоичные файлы сравниваем побайтово.
    const text = content.toString('utf8');
    const isText = !text.includes('\0') && Buffer.from(text).equals(content);
    files.set(file, sha256(isText ? text.replaceAll('\r\n', '\n') : content));
  }

  const entries = [...files];
  return Object.fromEntries(nodes.map(node => {
    const sources = node.code.map(source => source.replace(/\/$/, '')).sort();
    const owned = entries.filter(([file]) => sources.some(source => file === source || file.startsWith(source + '/')));
    return [node.id, sha256(JSON.stringify([sources, owned]))];
  }));
}

export function atlasCodeWarnings(hashes, reviewed) {
  return Object.entries(hashes).flatMap(([id, hash]) => {
    if (!Object.hasOwn(reviewed, id)) return [`${id}: нет отметки сверки кода карты — сверить блок`];
    return hash === reviewed[id] ? [] : [`${id}: код изменился после сверки карты — сверить блок`];
  });
}

export function readAtlasCodeReviews(root) {
  const reviewed = JSON.parse(fs.readFileSync(path.join(root, REVIEWS), 'utf8'));
  if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)
    || Object.values(reviewed).some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) {
    throw new Error(`неверный формат ${REVIEWS}`);
  }
  return reviewed;
}

export function recordAtlasCodeReview(root, node) {
  const hash = atlasCodeHashes(root, [node]);
  const file = path.join(root, REVIEWS);
  const pending = file + '.lock';
  const fd = fs.openSync(pending, 'wx');
  try {
    try {
      const reviewed = { ...readAtlasCodeReviews(root), ...hash };
      const sorted = Object.fromEntries(Object.entries(reviewed).sort(([a], [b]) => a.localeCompare(b, 'en')));
      fs.writeFileSync(fd, JSON.stringify(sorted, null, 2) + '\n');
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(pending, file);
  } catch (error) {
    fs.rmSync(pending, { force: true });
    throw error;
  }
}
