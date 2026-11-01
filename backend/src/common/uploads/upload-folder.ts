/** Папки новых загрузок: uploads/<назначение>/<ГГГГ-ММ>/<файл>. Старые файлы лежат плоско в uploads/ и не переносятся. */
export const UPLOAD_FOLDERS = ['passport', 'showcase', 'drawing', 'supply', 'other'] as const;
export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

/** Неизвестное или пустое назначение — `other` (имя от клиента в путь не попадает). */
export const uploadFolderOf = (v: unknown): UploadFolder => ((UPLOAD_FOLDERS as readonly string[]).includes(String(v)) ? (String(v) as UploadFolder) : 'other');

/** Относительная папка `passport/2026-11` (месяц — по UTC). */
export function uploadSubdir(folder: unknown, now: Date = new Date()): string {
  return `${uploadFolderOf(folder)}/${now.toISOString().slice(0, 7)}`;
}
