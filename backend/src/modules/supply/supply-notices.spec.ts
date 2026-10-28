import { requestReturn, requestReturnText } from './supply-notices';

describe('заявка вернулась / отменена', () => {
  it('назад по этапам и отмена — уведомляем', () => {
    expect(requestReturn('ordered', 'requested')).toBe('back');
    expect(requestReturn('requested', 'cancelled')).toBe('cancelled');
  });
  it('вперёд, без смены и из отмены — нет', () => {
    expect(requestReturn('requested', 'ordered')).toBeNull();
    expect(requestReturn('ordered', 'ordered')).toBeNull();
    expect(requestReturn('cancelled', 'in_progress')).toBeNull();
  });
  it('текст на языке менеджера', () => {
    expect(requestReturnText('back', 5, 'Болт', 'requested')).toBe('Заявка №5 Болт вернулась на этап «Запрошено»');
    expect(requestReturnText('cancelled', undefined, 'Болт', 'cancelled')).toBe('Заявка Болт отменена');
  });
});
