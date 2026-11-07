import type { Types } from 'mongoose';

/** Шаг маршрута в задании — снимок на момент запуска (правка маршрута изделия уже запущенное не меняет). */
export interface WorkStep {
  /** null — общая работа «Изготовление» (у изделия нет маршрута). */
  workTypeId: Types.ObjectId | null;
  name: string;
  /** Часть состава изделия (composition[]._id), к которой относится шаг; необязательно. */
  lineId?: Types.ObjectId;
  note?: string;
  /** Снимок плана позиции (C041): id шага плана, название части («Изделие целиком» — без части) и норма часов на 1 шт. */
  stepId?: Types.ObjectId;
  /** Часть изделия (parts[]._id) и отметка «Проверено» — есть в маршруте изделия, в снимок задания не пишутся. */
  partRowId?: Types.ObjectId;
  checked?: boolean;
  partName?: string;
  hours?: number;
  /** Исполнитель шага из плана позиции (C041 Э2): при переходе на шаг становится исполнителем задания. */
  assigneeId?: Types.ObjectId;
  /** Ручной план шага для Ганта; нет — вычисляется цепочкой (work-plan.ts). */
  plan?: { start: Date; days: number };
}
