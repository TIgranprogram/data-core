import type { ActionDef, TypeDef } from './question.types';

/**
 * Реестры «Разбора». Кнопка шлёт только questionId + optionCode; действие и параметры сервер берёт из своей записи.
 * Тип без `recheck` не регистрируется — иначе вопрос мог бы «повиснуть» навсегда.
 */
export class ControlRegistry {
  private readonly types = new Map<string, TypeDef>();
  private readonly actions = new Map<string, ActionDef>();

  addType(def: TypeDef): this {
    if (typeof def.recheck !== 'function') throw new Error(`Тип вопроса «${def.type}» без recheck не регистрируется`);
    if (this.types.has(def.type)) throw new Error(`Тип вопроса «${def.type}» уже зарегистрирован`);
    this.types.set(def.type, def);
    return this;
  }

  addAction(def: ActionDef): this {
    if (this.actions.has(def.id)) throw new Error(`Действие «${def.id}» уже зарегистрировано`);
    this.actions.set(def.id, def);
    return this;
  }

  type(t: string): TypeDef | undefined { return this.types.get(t); }
  action(id: string): ActionDef | undefined { return this.actions.get(id); }
  allTypes(): TypeDef[] { return [...this.types.values()]; }

  /**
   * Проверка на старте: у каждой кнопки типа с действием это действие есть в реестре.
   * Ошибка — сразу при запуске, а не при первом нажатии.
   */
  assertConsistent(): void {
    for (const t of this.types.values()) {
      const probe = t.options({ subject: { kind: '', ids: [] }, params: {} });
      for (const o of probe) {
        if (o.actionId && !this.actions.has(o.actionId)) throw new Error(`Тип «${t.type}»: кнопка «${o.code}» ссылается на неизвестное действие «${o.actionId}»`);
      }
    }
  }
}
