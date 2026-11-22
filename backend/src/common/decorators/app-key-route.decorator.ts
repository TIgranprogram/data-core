import { SetMetadata } from '@nestjs/common';

export const APP_KEY_ROUTE = 'appKeyRoute';

/** Метод AppDataController доступен ключу своего приложения с учётом прав и имени приложения. */
export const AppKeyRoute = () => SetMetadata(APP_KEY_ROUTE, true);
