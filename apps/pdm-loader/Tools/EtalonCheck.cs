using System.Globalization;
using System.Text;
using ClosedXML.Excel;
using DataCore.PdmLoader.Pdm;

namespace DataCore.PdmLoader.Tools;

public static class EtalonCheck
{
    public sealed record Result(int Matched, int Total, int Missing, int Extra, int QtyMismatch, string ReportText);

    /// <summary>
    /// aliases: обозначение-из-файла → другие написания (Number, кириллица).
    /// </summary>
    public static Result Compare(
        IReadOnlyDictionary<string, double> leafTotals,
        string xlsxPath,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? aliases = null)
    {
        var etalon = ReadEtalon(xlsxPath);
        var index = BuildIndex(leafTotals, aliases);

        var sb = new StringBuilder();
        int ok = 0, miss = 0, qty = 0;
        var usedLeafs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var (des, need) in etalon.OrderBy(x => x.Key))
        {
            if (!TryResolve(des, index, out var leafKey, out var got))
            {
                miss++;
                sb.AppendLine($"НЕТ\t{des}\tнужно {Fmt(need)}");
                continue;
            }
            usedLeafs.Add(leafKey);
            if (Math.Abs(got - need) > 0.01)
            {
                qty++;
                sb.AppendLine($"КОЛ-ВО\t{des}\tнужно {Fmt(need)}\tполучено {Fmt(got)}");
            }
            else ok++;
        }

        int extra = 0;
        foreach (var (des, got) in leafTotals.OrderBy(x => x.Key))
        {
            if (usedLeafs.Contains(des)) continue;
            // лист мог быть сопоставлен через алиас
            bool matched = false;
            if (aliases != null && aliases.TryGetValue(des, out var als))
            {
                foreach (var a in als)
                    if (etalon.ContainsKey(a) || etalon.Keys.Any(e => NormKey(e) == NormKey(a)))
                    { matched = true; break; }
            }
            if (!matched && etalon.Keys.Any(e => NormKey(e) == NormKey(des)))
                matched = true;
            if (matched) continue;
            extra++;
            sb.AppendLine($"ЛИШНЕЕ\t{des}\t{Fmt(got)}");
        }

        sb.Insert(0, $"Совпадение: {ok} из {etalon.Count}. Нет: {miss}. Кол-во: {qty}. Лишние: {extra}.{Environment.NewLine}");
        return new Result(ok, etalon.Count, miss, extra, qty, sb.ToString());
    }

    sealed class LeafIndex
    {
        public required Dictionary<string, (string Key, double Qty)> ByExact;
        public required Dictionary<string, (string Key, double Qty)> ByNorm;
    }

    static LeafIndex BuildIndex(
        IReadOnlyDictionary<string, double> leafTotals,
        IReadOnlyDictionary<string, IReadOnlyList<string>>? aliases)
    {
        var byExact = new Dictionary<string, (string, double)>(StringComparer.OrdinalIgnoreCase);
        var byNorm = new Dictionary<string, (string, double)>(StringComparer.OrdinalIgnoreCase);

        void Add(string lookup, string key, double qty)
        {
            if (string.IsNullOrWhiteSpace(lookup)) return;
            byExact[lookup] = (key, qty);
            byNorm[NormKey(lookup)] = (key, qty);
        }

        foreach (var (des, qty) in leafTotals)
        {
            Add(des, des, qty);
            if (aliases != null && aliases.TryGetValue(des, out var als))
            {
                foreach (var a in als)
                    Add(a, des, qty);
            }
        }
        return new LeafIndex { ByExact = byExact, ByNorm = byNorm };
    }

    static bool TryResolve(string etalonDes, LeafIndex index, out string leafKey, out double qty)
    {
        if (index.ByExact.TryGetValue(etalonDes, out var hit))
        {
            leafKey = hit.Item1; qty = hit.Item2; return true;
        }
        if (index.ByNorm.TryGetValue(NormKey(etalonDes), out hit))
        {
            leafKey = hit.Item1; qty = hit.Item2; return true;
        }
        leafKey = ""; qty = 0; return false;
    }

    /// <summary>
    /// Сводка обозначения метиза к латинице каталога: СП05↔SP05, ШП↔SHP, СК↔SK…
    /// (ANALYSIS Л4; эталон 6104 пишет SP05.035.D7982, Number — СП05.035.D7982).
    /// </summary>
    public static string NormKey(string s)
    {
        s = s.Trim().ToUpperInvariant();
        // диграфы кириллица → латиница (длинные сначала)
        foreach (var (cyr, lat) in new (string, string)[]
        {
            ("ПРШ", "PRSH"), ("ШП", "SHP"), ("СК", "SK"), ("СП", "SP"),
            ("БМ", "BM"), ("ГМ", "GM"), ("ГП", "GP"), ("ПИ", "PI"),
            ("Ш", "SH"), ("Б", "B"), ("Г", "G"), ("П", "P"), ("С", "S"),
            ("К", "K"), ("М", "M"), ("Р", "R"), ("Н", "H"), ("Т", "T"),
            ("А", "A"), ("В", "B"), ("Е", "E"), ("О", "O"), ("Х", "X"), ("У", "Y"),
        })
            s = s.Replace(cyr, lat, StringComparison.Ordinal);
        return s;
    }

    public static Dictionary<string, double> ReadEtalon(string xlsxPath)
    {
        using var wb = new XLWorkbook(xlsxPath);
        var ws = wb.Worksheets.First();
        int first = ws.FirstRowUsed()?.RowNumber() ?? 1;
        int last = ws.LastRowUsed()?.RowNumber() ?? 1;

        int headRow = first, colDes = -1, colQty = -1;
        for (int r = first; r <= Math.Min(first + 5, last); r++)
        {
            int d = -1, q = -1;
            var row = ws.Row(r);
            int lastCol = row.LastCellUsed()?.Address.ColumnNumber ?? 0;
            for (int c = 1; c <= lastCol; c++)
            {
                var t = row.Cell(c).GetString().Trim().TrimStart('\u00A0', ' ');
                if (d < 0 && t.Contains("Обознач", StringComparison.OrdinalIgnoreCase)) d = c;
                if (q < 0 && (t.Equals("К-во", StringComparison.OrdinalIgnoreCase)
                    || t.Equals("К-во.", StringComparison.OrdinalIgnoreCase)
                    || t.Equals("Кол-во", StringComparison.OrdinalIgnoreCase)
                    || t.Equals("Количество", StringComparison.OrdinalIgnoreCase)))
                    q = c;
            }
            if (d > 0 && q > 0) { headRow = r; colDes = d; colQty = q; break; }
        }
        if (colDes < 0 || colQty < 0)
            throw new InvalidOperationException("В эталоне не найдены колонки «Обозначение» и «К-во».");

        var map = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        for (int r = headRow + 1; r <= last; r++)
        {
            var des = ws.Cell(r, colDes).GetString().Trim().TrimStart('\u00A0', ' ');
            if (string.IsNullOrWhiteSpace(des)) continue;
            if (des.Contains('^')) des = des.Split('^')[0];
            if (des.Contains("Обознач", StringComparison.OrdinalIgnoreCase)) continue;

            double q;
            var cell = ws.Cell(r, colQty);
            if (cell.TryGetValue(out double qd)) q = qd;
            else if (!double.TryParse(cell.GetString().Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out q))
                continue;
            if (q <= 0) continue;
            map[des] = map.GetValueOrDefault(des) + q;
        }
        return map;
    }

    static string Fmt(double d) => d.ToString("0.###", CultureInfo.InvariantCulture);

    public static string FetchEtalonXlsx(VaultSession session, string rootDes = "6104.0000.0000")
    {
        var cached = Directory.EnumerateFiles(AppPaths.Cache, rootDes + "_BSUP_SD.xlsx", SearchOption.AllDirectories).FirstOrDefault()
            ?? Directory.EnumerateFiles(AppPaths.Cache, "*BSUP_SD*.xlsx", SearchOption.AllDirectories).FirstOrDefault();
        if (cached != null) return cached;

        var hits = PdmSearch.FindByDesignation(session, rootDes + "_BSUP_SD", ".xlsx");
        if (hits.Count == 0)
            hits = PdmSearch.FindByDesignation(session, rootDes + "_SD", ".xlsx");
        if (hits.Count == 0)
            throw new InvalidOperationException("Эталонный файл спецификации (*_BSUP_SD.xlsx) в PDM не найден.");
        var copy = PdmCopy.GetLatestCopy(hits[0].File, AppPaths.CacheFor("etalon_sd"))
            ?? throw new InvalidOperationException("Не удалось скопировать эталон из PDM.");
        return copy.LocalPath;
    }
}
