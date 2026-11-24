/** C264. Включён — хозяин записи брони и `storageitems.reservedQty` это API. Выключен — CRM снова может писать Mongo; маршруты не снимаются. Движение остатка и приход флаг не смотрит. `salesOrderId` маршрутов не подменяется. */
export const STOCK_RESERVE_API_FLAG = 'c264.stock.reserve.api';

export const STOCK_RESERVE_API_OFF = 'Флаг c264.stock.reserve.api выключен: бронь снова пишет CRM в Mongo. Маршруты API не сняты.';
