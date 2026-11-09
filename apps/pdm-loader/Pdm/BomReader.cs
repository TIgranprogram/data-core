using System.Globalization;
using System.Runtime.Versioning;
using System.Text.RegularExpressions;
using EPDM.Interop.epdm;

namespace DataCore.PdmLoader.Pdm;

/// <summary>
/// Computed BOM PDM. Количества — через SaveToCSV: GetVar по колонке «Количество» в этой версии API пустой.
/// </summary>
[SupportedOSPlatform("windows")]
public static class BomReader
{
    public sealed record BomRow(
        int Level,
        string Designation,
        string Config,
        double Qty,
        int FileId,
        string? Path,
        string? PdmKind,
        bool IsPromoteStub);

    public static void DumpDebug(VaultSession session, IEdmFile5 assembly, Action<string> log)
    {
        if (assembly is not IEdmFile7 f7)
            throw new InvalidOperationException("Нужен IEdmFile7");
        EdmBomLayout[]? layouts = null;
        var bomMgr = (IEdmBomMgr)((IEdmVault7)session.Vault).CreateUtility(EdmUtility.EdmUtil_BomMgr);
        bomMgr.GetBomLayouts(out layouts);
        string config = PickConfig(assembly);
        log($"config={config} layouts={(layouts?.Length ?? 0)}");
        if (layouts == null) return;
        Directory.CreateDirectory(AppPaths.Temp);
        foreach (var L in layouts)
        {
            string name = L.mbsLayoutName ?? "?";
            foreach (int flags in new[] { (int)EdmBomFlag.EdmBf_AsBuilt, 0 })
            {
                IEdmBomView? view = null;
                try { view = f7.GetComputedBOM(L.mlLayoutID, 0, config, flags); }
                catch (Exception ex) { log($"  layout «{name}» flags={flags}: {ex.Message}"); continue; }
                if (view == null) { log($"  layout «{name}» flags={flags}: null"); continue; }
                string csv = Path.Combine(AppPaths.Temp, $"bom-{Sanitize(name)}-f{flags}.csv");
                try
                {
                    ((IEdmBomView3)view).SaveToCSV(csv, true);
                    var lines = File.ReadAllLines(csv);
                    log($"  layout «{name}» flags={flags}: lines={lines.Length} → {csv}");
                    foreach (var line in lines.Take(3)) log("    " + line);
                }
                catch (Exception ex) { log($"  layout «{name}» flags={flags} csv: {ex.Message}"); }
            }
        }
        var rows = ReadComputedBom(session, assembly, null, log);
        log($"chosen rows={rows.Count}");
        foreach (var r in rows.Take(20))
            log($"  L{r.Level} {r.Designation} qty={r.Qty} cfg={r.Config}");
    }

    static string Sanitize(string s)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, '_');
        return s.Length > 40 ? s[..40] : s;
    }

    public static List<BomRow> ReadComputedBom(VaultSession session, IEdmFile5 assembly, string? preferredConfig, Action<string>? progress = null)
    {
        progress?.Invoke("Читаю спецификацию PDM…");
        if (assembly is not IEdmFile7 f7)
            throw new InvalidOperationException("Файл PDM не отдаёт спецификацию (нужен IEdmFile7).");

        EdmBomLayout[]? layouts = null;
        try
        {
            var bomMgr = (IEdmBomMgr)((IEdmVault7)session.Vault).CreateUtility(EdmUtility.EdmUtil_BomMgr);
            bomMgr.GetBomLayouts(out layouts);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Не удалось получить макеты спецификации PDM: " + ex.Message, ex);
        }
        if (layouts == null || layouts.Length == 0)
            throw new InvalidOperationException("В хранилище нет макетов спецификации (Computed BOM). Остановка — количества из дерева ссылок не берём.");

        var ordered = layouts
            .Select(L => (L.mlLayoutID, Name: L.mbsLayoutName ?? ""))
            .OrderBy(x => ScoreLayout(x.Name))
            .ToList();

        string config = preferredConfig ?? PickConfig(assembly);
        Exception? last = null;
        int layoutId = -1;
        string layoutName = "";
        IEdmBomView? asBuiltView = null;
        IEdmBomView? fullView = null;

        foreach (var (id, name) in ordered)
        {
            progress?.Invoke($"Спецификация «{name}», конфигурация «{config}»…");
            try
            {
                asBuiltView = f7.GetComputedBOM(id, 0, config, (int)EdmBomFlag.EdmBf_AsBuilt);
                if (asBuiltView != null) { layoutId = id; layoutName = name; break; }
            }
            catch (Exception ex) { last = ex; }
        }
        if (asBuiltView == null)
        {
            foreach (var (id, name) in ordered)
            {
                try
                {
                    asBuiltView = f7.GetComputedBOM(id, 0, config, 0);
                    if (asBuiltView != null) { layoutId = id; layoutName = name; break; }
                }
                catch (Exception ex) { last = ex; }
            }
        }
        if (asBuiltView == null)
            throw new InvalidOperationException("Computed BOM не читается. " + (last?.Message ?? ""), last);

        progress?.Invoke($"Открыта спецификация «{layoutName}»…");

        // AsBuilt совпадает с эталоном по модулям; полный BOM — полные дети подсборки 0000.5001.0000.
        var rows = SaveAndParse(asBuiltView, progress);
        try { fullView = f7.GetComputedBOM(layoutId, 0, config, 0); } catch { }
        if (fullView != null)
        {
            var full = SaveAndParse(fullView, progress);
            rows = MergeSubtreeChildren(rows, full, "0000.5001.0000");
        }
        if (rows.Count == 0)
            throw new InvalidOperationException("Спецификация пуста — проверьте конфигурацию сборки.");
        return rows;
    }

    static List<BomRow> SaveAndParse(IEdmBomView view, Action<string>? progress)
    {
        string csvPath = Path.Combine(AppPaths.Temp, $"bom-{Guid.NewGuid():N}.csv");
        try
        {
            ((IEdmBomView3)view).SaveToCSV(csvPath, true);
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException("Не удалось выгрузить спецификацию в CSV: " + ex.Message, ex);
        }
        if (!File.Exists(csvPath) || new FileInfo(csvPath).Length < 10)
            throw new InvalidOperationException("CSV спецификации пуст.");
        var parsed = ParseCsv(csvPath, progress);
        try { File.Delete(csvPath); } catch { }
        return parsed;
    }

    /// <summary>
    /// В AsBuilt у 0000.5001.0000 нет 0010–0012 и завышены qty 0004–0006.
    /// Подменяем детей этой подсборки строками из полного (не AsBuilt) BOM.
    /// </summary>
    public static List<BomRow> MergeSubtreeChildren(List<BomRow> asBuilt, List<BomRow> full, string parentDes)
    {
        int abParent = IndexOfDes(asBuilt, parentDes);
        int fullParent = IndexOfDes(full, parentDes);
        if (abParent < 0 || fullParent < 0) return asBuilt;

        int abParentLevel = asBuilt[abParent].Level;
        int abEnd = abParent + 1;
        while (abEnd < asBuilt.Count && asBuilt[abEnd].Level > abParentLevel) abEnd++;

        int fullParentLevel = full[fullParent].Level;
        var kids = new List<BomRow>();
        for (int i = fullParent + 1; i < full.Count && full[i].Level > fullParentLevel; i++)
        {
            var r = full[i];
            // сохраняем относительную глубину под новым родителем
            int rel = r.Level - fullParentLevel;
            kids.Add(r with { Level = abParentLevel + rel });
        }
        if (kids.Count == 0) return asBuilt;

        var merged = new List<BomRow>(asBuilt.Count - (abEnd - abParent - 1) + kids.Count);
        merged.AddRange(asBuilt.Take(abParent + 1));
        merged.AddRange(kids);
        merged.AddRange(asBuilt.Skip(abEnd));
        return merged;
    }

    static int IndexOfDes(List<BomRow> rows, string des)
    {
        for (int i = 0; i < rows.Count; i++)
            if (rows[i].Designation.Equals(des, StringComparison.OrdinalIgnoreCase))
                return i;
        return -1;
    }

    static List<BomRow> ParseCsv(string csvPath, Action<string>? progress)
    {
        var lines = File.ReadAllLines(csvPath);
        if (lines.Length < 2) return [];

        char sep = lines[0].Contains(';') ? ';' : ',';
        var head = SplitCsv(lines[0], sep);
        int iLevel = IndexOf(head, "Уровень", "Level");
        int iName = IndexOf(head, "Имя Файла", "File Name", "Имя");
        int iCfg = IndexOf(head, "Конфигурация", "Configuration");
        int iPart = IndexOf(head, "Номер Детали", "Part Number", "Обозначение");
        int iQty = IndexOf(head, "Количество", "QTY", "Qty", "Кол-во");

        var result = new List<BomRow>();
        // стек глубины по «Уровень» вида 1 / 6 / 6.1 / 6.1.2
        for (int li = 1; li < lines.Length; li++)
        {
            progress?.Invoke($"Читаю PDM… {li}/{lines.Length - 1}");
            var cols = SplitCsv(lines[li], sep);
            if (cols.Count == 0) continue;

            string levelStr = Get(cols, iLevel);
            int depth = LevelDepth(levelStr);
            string fileName = Get(cols, iName);
            string cfg = Get(cols, iCfg);
            if (IsSsConfig(cfg)) continue;

            string des = Get(cols, iPart);
            if (string.IsNullOrWhiteSpace(des) && !string.IsNullOrWhiteSpace(fileName))
                des = Path.GetFileNameWithoutExtension(fileName);
            if (des.Contains('^')) des = des.Split('^')[0];
            if (string.IsNullOrWhiteSpace(des)) continue;

            double qty = 1;
            var qs = Get(cols, iQty).Replace(',', '.').Trim();
            if (double.TryParse(qs, NumberStyles.Float, CultureInfo.InvariantCulture, out var q) && q > 0)
                qty = q;

            // путь неизвестен из CSV — только имя; FileId=0, найдём позже
            string? path = string.IsNullOrWhiteSpace(fileName) ? null : fileName;
            result.Add(new BomRow(depth, des, cfg, qty, 0, path, null, false));
        }
        return result;
    }

    static int LevelDepth(string level)
    {
        if (string.IsNullOrWhiteSpace(level)) return 1;
        // «6.1.2» → 3; «6» → 1
        return level.Split('.', StringSplitOptions.RemoveEmptyEntries).Length;
    }

    static int IndexOf(List<string> head, params string[] names)
    {
        for (int i = 0; i < head.Count; i++)
        {
            var h = head[i].Trim().Trim('"');
            foreach (var n in names)
                if (h.Equals(n, StringComparison.OrdinalIgnoreCase) || h.Contains(n, StringComparison.OrdinalIgnoreCase))
                    return i;
        }
        return -1;
    }

    static string Get(List<string> cols, int i) =>
        i >= 0 && i < cols.Count ? cols[i].Trim().Trim('"') : "";

    static List<string> SplitCsv(string line, char sep)
    {
        var list = new List<string>();
        var cur = new System.Text.StringBuilder();
        bool q = false;
        foreach (var ch in line)
        {
            if (ch == '"') { q = !q; continue; }
            if (ch == sep && !q) { list.Add(cur.ToString()); cur.Clear(); continue; }
            cur.Append(ch);
        }
        list.Add(cur.ToString());
        return list;
    }

    static int ScoreLayout(string name)
    {
        var n = name.ToLowerInvariant();
        if (n.Contains("подетал")) return 0;
        if (n.Contains("специф") && !n.Contains("сварн")) return 1;
        if (n.Contains("as built") || n.Contains("computed")) return 2;
        if (n.Contains("bom") || n.Contains("bill")) return 3;
        if (n.Contains("сварн") || n.Contains("вырез")) return 90;
        return 50;
    }

    static string PickConfig(IEdmFile5 file)
    {
        try
        {
            dynamic f = file;
            object[]? names = null;
            f.GetConfigurationNames(out names);
            if (names != null)
            {
                foreach (var n in names.OfType<string>())
                    if (!IsSsConfig(n)) return n;
            }
        }
        catch { }
        return "00 Стандартная";
    }

    public static bool IsSsConfig(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return false;
        return name.Contains("СС", StringComparison.OrdinalIgnoreCase)
            || Regex.IsMatch(name, @"\bSS\d*\b", RegexOptions.IgnoreCase);
    }
}
