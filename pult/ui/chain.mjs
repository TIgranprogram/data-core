// Пакетная цепочка «Выполнить все по очереди» допускает только безопасные read-only действия.
// Любая запись или команда с подтверждением запускается отдельно, через штатный диалог.
export function isBatchSafe(command) {
  return Boolean(
    command &&
    command.kind === 'job' &&
    command.risk === 'read' &&
    !command.confirm &&
    !command.word &&
    !(command.blocked?.length),
  );
}
