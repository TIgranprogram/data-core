/** Создание в несколько запросов: повтор продолжает уже созданную запись, а не делает дубль. */
export function createSession({ create, update, complete }) {
  let made = null; let running = null;
  return (body) => {
    if (running) return running;
    running = (async () => {
      try {
        made = made ? await update(made.id, body) : await create(body);
        return await complete(made, body);
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
}

/** Признаки выбранного среза относятся только к той группе, в которой их подтвердили. */
export const facetsForGroup = (selected, current, ids) => selected === current ? ids : [];
