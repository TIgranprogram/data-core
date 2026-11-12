/** Создание в несколько запросов: повтор продолжает уже созданную запись, а не делает дубль. */
export function createSession({ create, update, complete }) {
  let made = null; let running = null; let done = false;
  const save = (body) => {
    if (running) return running;
    running = (async () => {
      try {
        made = made ? await update(made.id, body) : await create(body);
        const res = await complete(made, body);
        done = true;
        return res;
      } catch (e) {
        if (made?.id) {
          const error = new Error(`Изделие уже создано. Не удалось закончить заполнение: ${e.message || e}. Повторите сохранение — продолжится эта же запись.`);
          error.cause = e;
          throw error;
        }
        throw e;
      }
    })().finally(() => { running = null; });
    return running;
  };
  /** C096 Э4: запись создана, а заполнение не закончено — её нельзя прятать и нельзя создавать заново. */
  save.partial = () => (made?.id && !done ? made : null);
  return save;
}

/** Признаки выбранного среза относятся только к той группе, в которой их подтвердили. */
export const facetsForGroup = (selected, current, ids) => selected === current ? ids : [];
