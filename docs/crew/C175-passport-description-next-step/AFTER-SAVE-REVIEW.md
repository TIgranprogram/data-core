# C175 — адресный review afterSave
Вердикт: **PASS**. Рассмотрен только новый optionalhook ui/kit/card.js и замена timerна него в passport-tree.js; код не менялся.
Hook вызывается после успешного единственного create/update, сбросаform и обхода прежнихstay/closeветок, до default opened/showView. undefined/false сохраняют прежнийпуть; true передаёт навигацию потребителю.
Ошибка hook ловится отдельно от API-save: сохранённаязапись не помечается«Не сохранено», повторного POST нет, fallbackоткрывает уже полученныйsaved. Saving/busyзащита старогоsaveпути не снята.
Passport-tree маршрутизирует по previousId syntheticnew.*, ане isNew: контекстныйкорень→new.savedRootId, обычныйновыйлист→saved.id, realIDedit→default. ОтложенныйsetTimeoutудалён, competingdefaultshowView после handledhook не выполняется.
Проверки: новые6create/update×default/handled/naverror кейсы card.test просмотрены; reported16card/34target/365guards/371imports0 приняты поотчётукоординатора. Backend/full777неповторялся и этимUIreviewнеподменяется.
Граница: настоящийbrowserroot→leaf→возврат принимаеткоординатор; данныйотчёт подтверждает узкий контракт/отсутствие обнаруженныхblockers вдвухфайлах.
