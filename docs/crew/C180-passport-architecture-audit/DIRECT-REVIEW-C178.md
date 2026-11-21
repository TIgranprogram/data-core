# C178 — прямой review замороженного diff
Вердикт: **можно к общей QA; блокеров в рассмотренном узком diff не найдено**. Это не приёмка всего паспортного контура/C179.
Просмотрены snapshot-revision helper/spec, service editSnapshotItem/Field+commitSnapshotEdit/saveCurrent, controller CurrentUser и UIcan/head.
История/CAS: sameSnapshot не считает служебное время; previous глубоко копируется без рекурсивныхrevisions, номер/printSnapshot/images не перезаписываются; revision и oldtext входят вусловия того же save, DocumentNotFound/VersionError→409.
Issuedshort-localdescription превращается в собственный текст экземпляра с прежнимиpartIds; следующая CADредакция не должнапересобратьэтоттекст изсловаря. Annulled запрещён доsamevalue; draftshort-прежнийпутьправки шаблонасохранён.
Printcontext не перечитывается длялокальноготекста, меняется textSnapshot. OrdinarynamePATCH и егоавторедакциянепереписаны. Promote-to-source этотdiffне делает правкойэкземпляра.
Controller сохраняет WORK/@Roles, добавляет автора без изменения тела. UIразделяетedit/issue: draft+issuedgeneratedv1редактируемы, filePDF/annulledreadonly; issuedне получает «Выпустить»/switchvariant, название имеетявныйвход.
Доказательства откоординатора: настоящийMongo6/6,807unitPASS; кодовыеsamevalue/history/annulled/shortown тесты просмотрены, повторныхпрогоновне делал. Реальныйbrowser/PDF/конкурентныйобщийfull—общаяприёмка послеfreezeC179, ею этотreviewне подменяется.
Рискграницы: installation/imagepolicy сейчас разъезжается междуисточниками — этоC179/ADVICE, не поводоткрыватьissuedбезистории. Полныйнеизменяемыйархивзакрытого+оплаченного заказа ещёне реализован.
