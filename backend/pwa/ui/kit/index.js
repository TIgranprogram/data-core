export { fileButton, select, field, textInput, badge, card, actions, clamp, row, headbar, segmented, link, grp, sku, section, stack, scroll, fieldRow, stat, stats, pad, toolbar, boardStatic, layout, button, iconButton, empty, tabs, hint, tileGrid, landing, miniChart, navList, photoStrip } from './basics.js';
export { mountBoard as board } from './board.js';
export { table } from './table.js';
export { treeTable } from './tree-table.js';
export { links } from './links.js';
export { panel } from './panel.js';
export { entityPanel } from './entity-panel.js';

/** Семейство mobile — мобильные рабочие экраны (ui/kit/mobile.js) */
export { mobile, catArt, typeArt, typeIconList } from './mobile.js';

// ---- Реэкспорт существующих эталонов ----
export { modal, confirmDlg } from './dialog.js';
export { openPdfPreview } from './pdf-preview.js';
export { toast, toastError } from './toast.js';
export { failBlock, busyBlock } from './busy.js';
export { errText } from './errors.js';
export { mountList } from './list.js';
export { autoMore } from './auto-more.js';
export { qtyInput } from './qty-input.js';
export { folderTile } from './folder-tile.js';
export { srcBox, srcLegend, srcPaint } from './src.js';
export { targetPicker, targetNote, targetShort, orderLines, lineCode } from './target-picker.js';
export { openCard } from './card.js';
export { pick, enhanceSelect, isLong, attachCombo, tagPick, attachSuggest } from './pick.js';
export { filter, chipsFilter, stepFunnel, facetFilter, parseFt, ftQuery, ftParams } from './filter.js';
export { SUPPLY_STATUS, INVOICE_STATUS, STOCK_STATUS, DESIGN_STATUS, ORDER_PRIORITY, PRIORITY, supplyKey } from './badges.js';
export { openPopMenu } from './pop-menu.js';
export { draggable, afterDrag } from './drag.js';
export { carousel } from './gallery.js';
export { uploadPhoto, photoDrop } from './photos.js';
export { sideForm, sideNote, openSide } from './side-form.js';

/** Хвост хлебных крошек раздела: crumbTail('Паспорта › Выпущенные паспорта') */
export { setCrumbTail as crumbTail } from './crumbs.js';
export { buildForm } from './form.js';

/** Подсказка «похожее уже есть» под названием изделия — ui/kit/similar.js */
export { similarBox } from "./similar.js";

export { searchBox } from './searchbox.js';
export { readonlyGroup, readonlyGroups } from './readonly.js';
export { photoField } from './photos.js';

/** Путеводитель (help и обучающие схемы): cat/unit/chain/flow/note/toggle — ui/kit/guide.js */
export { guide } from './guide.js';
export { stageBar, headStats } from './stage-bar.js';
export { funnel } from './funnel.js';
export { planner } from './planner.js';

/** Фото позиции/изделия в таблицах и строках (клик — крупно; нет фото — «нет фото») — ui/pos-pic.js */
export { posPic, posPicOf } from './pos-pic.js';
export { catalogShelves } from './blocks.js';
