window.mountRoleOperations = function (r, { el, base, own, roleList }) {
    const lMoney = el('label', 'rl-money'); const money = el('input'); money.type = 'checkbox';
    const fullMoney = r.name === 'admin' || r.name === 'director';
    money.checked = fullMoney || r.money === true; money.disabled = fullMoney;
    lMoney.append(money, el('span', '', 'Деньги'));
    const moneyHint = el('p', 'muted small', 'Без галочки цены и суммы скрыты везде.');
    const cartLabel = el('label', 'rl-money'), cart = el('input'); cart.type = 'checkbox';
    cartLabel.append(cart, el('span', '', 'Создание заявок из каталога'));
    const cartHint = el('p', 'muted small', 'Корзина доступна в разделе «Заявки» в пределах складских прав роли. Владелец всегда может оформлять заявки из каталога.');
    const resetCart = el('button', 'btn btn-sm', 'Вернуть по умолчанию');
    resetCart.type = 'button';
    const originalChoice = Object.hasOwn(r, 'requestCartCreateOverride') ? r.requestCartCreateOverride : r.requestCartCreate;
    let cartExplicit = typeof originalChoice === 'boolean';
    const syncCart = () => {
      resetCart.hidden = !cartExplicit;
      if (cartExplicit) return;
      const key = base?.value || r.baseRole || r.name;
      const fromBase = own && roleList.items.find(item => item.name === key);
      cart.checked = typeof fromBase?.requestCartCreate === 'boolean' ? fromBase.requestCartCreate
        : ['admin', 'manager', 'accountant', 'director'].includes(key);
    };
    cart.checked = originalChoice === true; syncCart();
    cart.addEventListener('change', () => { cartExplicit = true; syncCart(); });
    resetCart.onclick = () => { cartExplicit = false; syncCart(); };
    const cartChoice = () => cartExplicit ? (cart.checked === originalChoice ? undefined : cart.checked)
      : typeof originalChoice === 'boolean' ? null : undefined;
    return { lMoney, moneyHint, money, cartLabel, cartHint, resetCart, syncCart, cartChoice };
};
