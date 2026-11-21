# C179 — прямой review после исправления legacy blocker
Вердикт: **PASS адресного повторного review, можно к общему full**. Кодне менялся; рассмотрены только прежнийfinding, reconcileInstallationRules/serviceguard и два регрессионныхкейса.
Закрыто: service evaluatePresentation при новойimage-onlyредакции больше не смешивает новыйprofile состарымиmanaged required/slots. reconcileInstallationRules удаляет прежниеmanaged виды и добавляетrequiredKinds/allowedKinds единогопрофиля; прежниеnon-managedтребования/slotsсохраняются.
Текст/стиль/организация остаютсяfrozen; новаяредакция записываетсвой installationPlan. ИсторическийREAD/PDFбезплана остаётся прежним и не использует этотmutationпуть.
Unknownguard добавляетinstallationTypeIdmissing даже при savedText/reuseText; новыйimage-onlyPATCHunknown400 не создаётредакцию и не изменяетдокумент. Importunknown409дооперации сохранён.
Новые realMongoрегрессии просмотрены: legacyANCHORSбезplan+старыеfoundation/holesrequired→CADmounting→ready/тотженомер/oldrevision/PDF; repeatnoop иstalecontext409безчастичнойзаписи; unknownmutationrollback. Result3/3PASS принятпоQA, сам повторнонепрогонял.
ПредыдущийreviewостальногоC179 сохраняется: exact7profiles+unknown, sharedtraits/rules/compose/schemes/PDF/import, explicitmethodtransitionиузкоеmissing-new-schemeexception. C178directPASSнеотменён.
Доказательстваfreezeисполнителя: unit818/tsc0/eslint0, import23/23, C1786/6, C1793/3. Общийfull/browser/данные622/prodrelease ещё не принимаются этимдокументом; их ведёткоординатор.
