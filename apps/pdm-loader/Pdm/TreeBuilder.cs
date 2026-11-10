using System.Globalization;
using System.Runtime.Versioning;
using System.Security.Cryptography;
using System.Text.Json;
using DataCore.PdmLoader.Model;
using EPDM.Interop.epdm;

namespace DataCore.PdmLoader.Pdm;

[SupportedOSPlatform("windows")]
public sealed class TreeBuilder
{
    readonly VaultSession _session;
    readonly IntPtr _hwnd;
    readonly Action<string> _progress;
    readonly List<PdmWarning> _warnings = [];
    readonly Dictionary<string, List<PdmSearch.Hit>> _searchCache = new(StringComparer.OrdinalIgnoreCase);

    // обозначение → умноженное количество на корень (для сверки эталона)
    public Dictionary<string, double> LeafTotals { get; } = new(StringComparer.OrdinalIgnoreCase);

    public TreeBuilder(VaultSession session, IntPtr hwnd = default, Action<string>? progress = null)
    {
        _session = session;
        _hwnd = hwnd;
        _progress = progress ?? (_ => { });
    }

    public PdmTree Build(string rootDesignation, bool withFiles = true, bool withBlanks = true)
    {
        AppPaths.CleanOldCache();
        var hit = PdmSearch.FindAssembly(_session, rootDesignation, _progress)
            ?? throw new InvalidOperationException($"Изделие «{rootDesignation}» в PDM не найдено.");

        string rootConfig = "00 Стандартная";
        var bomRows = BomReader.ReadComputedBom(_session, hit.File, rootConfig, _progress);

        var erpBom = new List<BomLink>();
        var itemsByDes = new Dictionary<string, PdmItem>(StringComparer.OrdinalIgnoreCase);
        var rootVars = Variables.Read(hit.File, rootConfig);
        itemsByDes[rootDesignation] = MakeItem(rootDesignation, hit, rootVars, rootConfig, isRoot: true, withFiles: withFiles, withBlanks: withBlanks);

        var fileByDes = new Dictionary<string, PdmSearch.Hit>(StringComparer.OrdinalIgnoreCase)
        {
            [rootDesignation] = hit,
        };
        LeafTotals.Clear();
        FlattenBom(bomRows, rootDesignation, rootConfig, hit, itemsByDes, erpBom, fileByDes, withFiles, withBlanks);

        // запрещённые в items
        foreach (var bad in new[] { "SMI.6104.0001", "SM.2001", "S.BM08.D603.01" })
        {
            if (itemsByDes.ContainsKey(bad))
                _warnings.Add(new PdmWarning { Designation = bad, Code = "promote-leak", Text = $"«{bad}» не должен попадать в состав (Продвинуть)" });
        }

        ComputeLeafTotals(rootDesignation, erpBom);

        return new PdmTree
        {
            Vault = _session.Name,
            ReadAt = DateTime.UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture),
            Root = rootDesignation,
            Items = itemsByDes.Values.OrderBy(i => i.Designation, StringComparer.OrdinalIgnoreCase).ToList(),
            Bom = erpBom,
            Warnings = _warnings,
        };
    }

    void FlattenBom(
        List<BomReader.BomRow> rows,
        string rootDes,
        string rootConfig,
        PdmSearch.Hit rootHit,
        Dictionary<string, PdmItem> items,
        List<BomLink> bom,
        Dictionary<string, PdmSearch.Hit> fileByDes,
        bool withFiles,
        bool withBlanks)
    {
        // Mult — во сколько раз умножать qty ребёнка, чтобы получить количество на erp-родителя
        var stack = new List<(int Level, string Parent, double Mult)>();
        stack.Add((-1, rootDes, 1.0));

        var bomAcc = new Dictionary<(string P, string C), double>();

        int idx = 0;
        foreach (var row in rows)
        {
            idx++;
            _progress($"Разбираю спецификацию… {idx}/{rows.Count}");
            if (BomReader.IsSsConfig(row.Config)) continue;
            var des = row.Designation;
            if (string.IsNullOrWhiteSpace(des)) continue;
            if (des.Equals(rootDes, StringComparison.OrdinalIgnoreCase) && row.Level <= 0) continue;

            while (stack.Count > 1 && stack[^1].Level >= row.Level)
                stack.RemoveAt(stack.Count - 1);

            var (_, parent, mult) = stack[^1];
            double qty = row.Qty > 0 ? row.Qty : 1;

            string? pdmKind = row.PdmKind;
            IEdmFile5? file = null;
            IEdmFolder5? folder = null;
            string path = row.Path ?? "";
            if (row.FileId != 0)
            {
                try { file = (IEdmFile5)_session.Vault.GetObject(EdmObjectType.EdmObject_File, row.FileId); }
                catch { }
            }
            if (file == null && path.Contains('\\'))
            {
                try { file = _session.Vault.GetFileFromPath(path, out folder); } catch { }
            }
            if (file == null)
            {
                // CSV даёт только имя — ищем по обозначению
                var hits = SearchCached(des, ".sldprt", ".sldasm");
                if (hits.Count > 0) { file = hits[0].File; folder = hits[0].Folder; path = hits[0].Path; }
            }

            Dictionary<string, string?> vars = new();
            if (file != null)
            {
                vars = Variables.Read(file, row.Config);
                pdmKind ??= vars.GetValueOrDefault("Вид_изделия");
                fileByDes[des] = new PdmSearch.Hit(file, folder!, path, file.Name);
            }

            if (IsPromote(row, pdmKind, vars))
            {
                stack.Add((row.Level, parent, mult * qty));
                continue;
            }

            if (!items.ContainsKey(des))
            {
                var useHit = file != null
                    ? fileByDes[des]
                    : new PdmSearch.Hit(rootHit.File, rootHit.Folder, path, des);
                // kind=null → MakeItem возьмёт Вид_изделия или папку PDM
                items[des] = MakeItem(des, useHit, vars, row.Config, isRoot: false, kind: null, pdmKind, withFiles, withBlanks);
            }

            double linkQty = qty * mult;
            var key = (parent, des);
            bomAcc[key] = bomAcc.GetValueOrDefault(key) + linkQty;
            stack.Add((row.Level, des, 1.0));
        }

        foreach (var kv in bomAcc.OrderBy(k => k.Key.P).ThenBy(k => k.Key.C))
        {
            bom.Add(new BomLink { Parent = kv.Key.P, Child = kv.Key.C, Qty = kv.Value });
        }
    }

    void ComputeLeafTotals(string root, List<BomLink> bom)
    {
        var children = bom.GroupBy(b => b.Parent, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);
        void Walk(string node, double mult)
        {
            if (!children.TryGetValue(node, out var list))
            {
                LeafTotals[node] = LeafTotals.GetValueOrDefault(node) + mult;
                return;
            }
            foreach (var link in list)
                Walk(link.Child, mult * link.Qty);
        }
        Walk(root, 1);
        // корень не лист
        LeafTotals.Remove(root);
    }

    static bool IsPromote(BomReader.BomRow row, string? pdmKind = null, Dictionary<string, string?>? vars = null)
    {
        // Computed BOM обычно не показывает promote-сборки. Страховка по виду+имени.
        pdmKind ??= row.PdmKind ?? vars?.GetValueOrDefault("Вид_изделия");
        var des = row.Designation ?? "";
        if (pdmKind is "Сборочный модуль" or "Соединение") return true;
        if (des.StartsWith("SMI.", StringComparison.OrdinalIgnoreCase)) return true;
        if (des.StartsWith("SM.", StringComparison.OrdinalIgnoreCase) && des.Count(c => c == '.') == 1) return true;
        if (des.StartsWith("S.", StringComparison.OrdinalIgnoreCase) && des.Contains(".D", StringComparison.OrdinalIgnoreCase)) return true;
        return row.IsPromoteStub;
    }

    PdmItem MakeItem(string des, PdmSearch.Hit hit, Dictionary<string, string?> vars, string? config, bool isRoot, string? kind = null, string? pdmKind = null, bool withFiles = true, bool withBlanks = true)
    {
        pdmKind ??= vars.GetValueOrDefault("Вид_изделия");
        if (isRoot)
            kind = "product";
        else
        {
            if (string.IsNullOrWhiteSpace(kind))
            {
                if (!string.IsNullOrWhiteSpace(pdmKind))
                    kind = Variables.KindFromPdm(pdmKind, false);
                else
                {
                    // Вид_изделия пуст даже в «@» — запасной путь: папка PDM (с warning).
                    kind = Variables.KindFromPath(hit.Path);
                    if (kind == "product") kind = null; // изделие — только корень
                    var ext = Path.GetExtension(hit.Path ?? hit.Name ?? "").ToLowerInvariant();
                    if (kind == null && ext is ".sldasm") kind = "module";
                    kind ??= "part";
                    _warnings.Add(new PdmWarning
                    {
                        Designation = des,
                        Code = "kind-from-folder",
                        Text = $"Вид_изделия пуст — взят из папки PDM ({kind})",
                    });
                }
            }
            pdmKind ??= Variables.PdmKindLabel(kind!);
        }

        var number = vars.GetValueOrDefault("Number");
        var aliases = new List<string>();
        if (!string.IsNullOrWhiteSpace(number) && !number.Equals(des, StringComparison.OrdinalIgnoreCase))
        {
            aliases.Add(number);
            _warnings.Add(new PdmWarning
            {
                Designation = des,
                Code = "number-mismatch",
                Text = $"Обозначение в карточке PDM «{number}» не совпадает с именем файла — на сайте найдётся по обоим", // 2026-11-10: было «Number …»
            });
        }

        var item = new PdmItem
        {
            Designation = des,
            Kind = kind!,
            PdmKind = pdmKind,
            Aliases = aliases,
            Config = config,
            Vars = new Dictionary<string, string?>
            {
                ["Сортамент"] = vars.GetValueOrDefault("Сортамент"),
                ["Материал"] = vars.GetValueOrDefault("Материал"),
                ["Длина"] = vars.GetValueOrDefault("Длина"),
                ["Ширина"] = vars.GetValueOrDefault("Ширина"),
                ["Толщина"] = vars.GetValueOrDefault("Толщина"),
                ["Длина_заготовки"] = vars.GetValueOrDefault("Длина_заготовки"),
                ["Масса"] = vars.GetValueOrDefault("Масса"),
                ["Number"] = number,
                ["RAL"] = vars.GetValueOrDefault("RAL"),
            },
            Size = new SizeDto
            {
                Length = Variables.Num(vars, "Длина"),
                Width = Variables.Num(vars, "Ширина"),
                Thickness = Variables.Num(vars, "Толщина"),
            },
            MassKg = Variables.Num(vars, "Масса"),
            Ral = string.IsNullOrWhiteSpace(vars.GetValueOrDefault("RAL")) ? null : [vars["RAL"]!],
            Docs = [],
        };

        try
        {
            item.File = new FileInfoDto
            {
                Id = hit.File.ID,
                Path = hit.Path ?? "",
                Version = hit.File.CurrentVersion,
                State = hit.File.CurrentState?.Name,
                Modified = null,
            };
        }
        catch { }

        if (isRoot)
        {
            try
            {
                dynamic folder = hit.Folder;
                dynamic parent = folder.GetParentFolder();
                item.Folder = (string?)parent.Name;
            }
            catch { item.Folder = "61 Детские игровые комплексы"; }
        }

        if (kind == "part")
            item.Blank = ResolveBlank(des, vars, withFiles || withBlanks);

        if (withFiles && kind is "product" or "module" or "part")
        {
            AttachDocs(item, des, kind);
            TryPreview(item, hit);
        }

        return item;
    }

    void TryPreview(PdmItem item, PdmSearch.Hit hit)
    {
        try
        {
            var pdfLocals = new List<string>();
            foreach (var d in item.Docs.Where(x => x.Type is "pdf" or "assembly" or "install"))
            {
                var cached = Directory.EnumerateFiles(AppPaths.Cache, d.Name, SearchOption.AllDirectories).FirstOrDefault();
                if (cached != null) pdfLocals.Add(cached);
            }
            var rel = PreviewImage.BuildForItem(_session, hit, item.Designation, pdfLocals, _hwnd);
            if (rel != null) item.Preview = rel;
        }
        catch (Exception ex)
        {
            _warnings.Add(new PdmWarning { Designation = item.Designation, Code = "preview", Text = "Картинка: " + ex.Message });
        }
    }

    BlankDto? ResolveBlank(string des, Dictionary<string, string?> vars, bool withFiles)
    {
        var assortment = vars.GetValueOrDefault("Сортамент");
        double? thick = DxfBlank.ThicknessFromAssortment(assortment) ?? Variables.Num(vars, "Толщина");
        bool sheet = DxfBlank.IsSheetAssortment(assortment);

        // DXF: сортамент в карточке часто пуст, а развёртка в PDM есть.
        if (withFiles || sheet)
        {
            try
            {
                var dxfs = SearchCached(des, ".dxf");
                if (dxfs.Count > 0)
                {
                    var copy = PdmCopy.GetLatestCopy(dxfs[0].File, AppPaths.CacheFor(des + "_dxf"), _hwnd);
                    if (copy != null)
                    {
                        var m = DxfBlank.Measure(copy.LocalPath);
                        if (m != null)
                        {
                            // Толщина листа — только из сортамента или явно тонкого размера PDM (≤20), не из габарита 3D.
                            double? tSheet = DxfBlank.ThicknessFromAssortment(assortment);
                            if (tSheet == null)
                            {
                                var candidates = new[] { Variables.Num(vars, "Длина"), Variables.Num(vars, "Ширина"), Variables.Num(vars, "Толщина") }
                                    .Where(x => x != null && x > 0 && x <= 20).Select(x => x!.Value).ToList();
                                if (candidates.Count > 0) tSheet = candidates.Min();
                            }
                            return new BlankDto
                            {
                                Length = m.Value.Length,
                                Width = m.Value.Width,
                                Thickness = tSheet,
                                Source = "dxf",
                            };
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _warnings.Add(new PdmWarning { Designation = des, Code = "dxf-read", Text = "Развёртка: " + ex.Message });
            }
        }

        if (sheet || assortment == null)
        {
            var L = Variables.Num(vars, "Длина");
            var W = Variables.Num(vars, "Ширина");
            var T = Variables.Num(vars, "Толщина");
            if (L != null && W != null && T != null)
            {
                // плоская заготовка: две большие стороны, толщина — наименьшая
                var dims = new[] { L.Value, W.Value, T.Value }.OrderByDescending(x => x).ToArray();
                if (dims[2] <= 30 && dims[0] > dims[2] * 2)
                    return new BlankDto { Length = dims[0], Width = dims[1], Thickness = dims[2], Source = "pdm" };
            }
            if (sheet && L != null && W != null)
                return new BlankDto { Length = Math.Max(L.Value, W.Value), Width = Math.Min(L.Value, W.Value), Thickness = thick, Source = "pdm" };
            if (sheet) return null;
        }

        // трубы / брус
        var len = Variables.Num(vars, "Длина_заготовки") ?? Variables.Num(vars, "Длина");
        if (len != null)
            return new BlankDto { Length = len, Width = null, Thickness = null, Source = "pdm" };
        return null;
    }

    List<PdmSearch.Hit> SearchCached(string des, params string[] ext)
    {
        var key = des + "|" + string.Join(",", ext);
        if (_searchCache.TryGetValue(key, out var hit)) return hit;
        hit = PdmSearch.FindByDesignation(_session, des, ext);
        _searchCache[key] = hit;
        return hit;
    }

    void AttachDocs(PdmItem item, string des, string kind)
    {
        try
        {
            var pdfs = SearchCached(des, ".pdf");
            var dxfs = SearchCached(des, ".dxf");
            foreach (var h in dxfs.Take(1))
                TryAddDoc(item, h, "dxf");
            foreach (var h in pdfs.Take(1))
                TryAddDoc(item, h, "pdf");

            if (kind == "product")
            {
                foreach (var h in SearchCached(des + "_SS", ".pdf").Take(1))
                    TryAddDoc(item, h, "assembly");
                foreach (var h in SearchCached(des + "_BSUP", ".pdf").Take(1))
                    TryAddDoc(item, h, "install");
            }
        }
        catch (Exception ex)
        {
            _warnings.Add(new PdmWarning { Designation = des, Code = "docs", Text = ex.Message });
        }
    }

    void TryAddDoc(PdmItem item, PdmSearch.Hit h, string type)
    {
        try
        {
            var copy = PdmCopy.GetLatestCopy(h.File, AppPaths.CacheFor(item.Designation + "_" + type), _hwnd);
            if (copy == null) return;
            string rel = $"files/{item.Designation}/v{copy.Version}/{Path.GetFileName(copy.LocalPath)}";
            item.Docs.Add(new DocDto
            {
                Type = type,
                Name = Path.GetFileName(copy.LocalPath),
                PdmFileId = h.File.ID,
                Version = copy.Version,
                State = copy.State,
                Modified = copy.Modified?.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'"),
                Sha256 = copy.Sha256,
                Size = copy.Size,
                File = rel,
            });
        }
        catch (Exception ex)
        {
            _warnings.Add(new PdmWarning { Designation = item.Designation, Code = "doc-copy", Text = ex.Message });
        }
    }

    public static string ToJson(PdmTree tree) =>
        JsonSerializer.Serialize(tree, new JsonSerializerOptions { WriteIndented = true, DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull });
}
