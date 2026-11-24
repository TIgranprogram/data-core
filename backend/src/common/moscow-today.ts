/** Сегодня по Москве, ГГГГ-ММ-ДД. Не правило счёта и не дата факта оплаты. */
export const moscowToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
