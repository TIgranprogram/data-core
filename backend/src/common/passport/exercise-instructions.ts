import { BadRequestException } from '@nestjs/common';

export const EXERCISE_LABELS = { initialPosition: 'Исходное положение', movement: 'Движения и завершение', muscles: 'Задействованные мышцы' } as const;
export type ExerciseInstructions = Record<keyof typeof EXERCISE_LABELS, string>;
export type ExerciseSnapshot = ExerciseInstructions & { source: { kind: 'product'; productId: string } };
export const EXERCISE_TITLE = 'Инструкция упражнения';
export const exerciseParagraphs = (text: string) => text.split(/\n\s*\n/).filter(Boolean);

/** Один валидатор для модели, CAS и захваченного текста; baseline не нормализуем. */
export function exerciseInstructions(raw: unknown, baseline = false): ExerciseInstructions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype) throw new BadRequestException('Инструкция упражнения: требуется объект из трёх полей');
  const rec = raw as Record<string, unknown>;
  const keys = Object.keys(EXERCISE_LABELS) as Array<keyof ExerciseInstructions>;
  if (Object.keys(rec).some(key => !keys.includes(key as keyof ExerciseInstructions))) throw new BadRequestException('Инструкция упражнения: неизвестное поле');
  const out = {} as ExerciseInstructions;
  for (const key of keys) {
    const value = rec[key];
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${EXERCISE_LABELS[key]}: заполните поле`);
    if (/<[^>]*>|[{}]|\b(?:undefined|null)\b/i.test(value)) throw new BadRequestException(`${EXERCISE_LABELS[key]}: нужен обычный текст без HTML и служебных подстановок`);
    out[key] = baseline ? value : value.replace(/\r\n/g, '\n').trim();
  }
  if (keys.reduce((sum, key) => sum + out[key].replace(/\r\n/g, '\n').trim().length, 0) > 4000) throw new BadRequestException('Инструкция упражнения: общий лимит 4000 символов');
  return out;
}
