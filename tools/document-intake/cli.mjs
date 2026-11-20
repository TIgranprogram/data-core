#!/usr/bin/env node
import { configure, report, resume, run, status } from './index.mjs';
import { IntakeError } from './store.mjs';

const commands = { configure, status, report, run, resume };
const [command, root, ...extra] = process.argv.slice(2);
if (!Object.hasOwn(commands, command) || !root || extra.length) {
  console.error('Использование: node tools/document-intake/cli.mjs <configure|status|report|run|resume> <абсолютная-папка>');
  process.exitCode = 2;
} else {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  const token = process.env.DATACORE_INTAKE_TOKEN;
  // Не передавать ключ дочерним процессам, читающим оригинал.
  delete process.env.DATACORE_INTAKE_TOKEN;
  try {
    const result = await commands[command]({
      root,
      token,
      apiBase: process.env.DATACORE_INTAKE_API,
      modelBase: process.env.DATACORE_INTAKE_MODEL_BASE,
      model: process.env.DATACORE_INTAKE_MODEL,
      signal: controller.signal,
      onProgress: ({ processed, total, current, message }) => console.error(JSON.stringify({ processed, total, current, message })),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.stopped) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof IntakeError ? error.message : 'Не удалось открыть папку или журнал документов.');
    process.exitCode = 1;
  }
}
