# CL-B — запросы к kit
- button(): параметр `cls` (и `warm`) — вернуть `mob-arr-accept` (на всю ширину на телефоне), `so-add`, `btn-warm`.
- select-фабрика: `field({type:'select', options})` или `select()` в kit — снять ~10 `h('select')` (order-line-actions:72,90,108, order-lines:124, stock-ops:77,175, issue:57, item-orders:80, salesorders:154, salesorders-unassigned:104).
- card({size:'S'}) с art-картинкой и `aria-expanded` — плитки склада stock.js:114,129.
- mobile: аналоги `m-cart-x`, `mob-act` (warehouse-mobile:26), шапка списка stock-mobile:399.
- Тег-кнопка «×» для выбранных позиций (stock-zones:76).
