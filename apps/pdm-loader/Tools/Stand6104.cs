using System.Text;
using System.Text.Json;
using DataCore.PdmLoader.Model;
using DataCore.PdmLoader.Pdm;
using DataCore.PdmLoader.Site;

namespace DataCore.PdmLoader.Tools;

/// <summary>Приёмка Э2б: preview → apply → files → повтор → purchase-needs → pdm-files на localhost.</summary>
public static class Stand6104
{
    public static int Run(Dictionary<string, string?> flags)
    {
        string baseUrl = flags.GetValueOrDefault("url") ?? "http://localhost:3001";
        string user = flags.GetValueOrDefault("user") ?? Environment.GetEnvironmentVariable("STAND_LOGIN") ?? "admin";
        string pass = flags.GetValueOrDefault("pass")
            ?? Environment.GetEnvironmentVariable("STAND_PASSWORD")
            ?? ReadAdminPasswordFromEnv()
            ?? throw new InvalidOperationException("Укажите --pass или STAND_PASSWORD / ADMIN_PASSWORD в .env");

        var samples = FindSamplesDir();
        Directory.CreateDirectory(samples);
        var report = new StringBuilder();
        void Log(string s) { Console.WriteLine(s); report.AppendLine(s); }

        Log($"Стенд: {baseUrl}, пользователь: {user}");
        using var site = new SiteClient(baseUrl);
        site.LoginAsync(user, pass).GetAwaiter().GetResult();
        Log("Вход: ок");

        PdmTree tree;
        string? jsonPath = flags.GetValueOrDefault("json");
        bool withFiles = !flags.ContainsKey("no-files");
        if (!string.IsNullOrWhiteSpace(jsonPath) && File.Exists(jsonPath))
        {
            tree = JsonSerializer.Deserialize<PdmTree>(File.ReadAllText(jsonPath!).TrimStart('\uFEFF'))
                ?? throw new InvalidOperationException("JSON дерева пуст");
            Log($"Дерево из JSON: {jsonPath}, позиций {tree.Items.Count}");
        }
        else
        {
            Log(withFiles ? "Читаю PDM с файлами…" : "Читаю PDM без файлов…");
            using var session = VaultSession.LoginAuto();
            var b = new TreeBuilder(session, IntPtr.Zero, Console.WriteLine);
            tree = b.Build("6104.0000.0000", withFiles: withFiles, withBlanks: true);
            var outJson = Path.Combine(samples, "6104.pdm-tree.json");
            File.WriteAllText(outJson, TreeBuilder.ToJson(tree), Encoding.UTF8);
            Log($"Дерево записано: {outJson}");
        }

        // --- 1) preview ---
        Log("POST /api/pdm-import/preview …");
        using var previewDoc = site.PreviewAsync(tree).GetAwaiter().GetResult();
        var preview = previewDoc.RootElement.Clone();
        File.WriteAllText(Path.Combine(samples, "6104.preview.json"), preview.GetRawText(), Encoding.UTF8);
        string planId = preview.GetProperty("planId").GetString()
            ?? throw new InvalidOperationException("Нет planId");
        var summary = preview.GetProperty("summary");
        Log($"planId={planId} summary={summary}");

        var decisions = BuildDecisions(preview);
        Log($"Решений: {decisions.Count}");

        // --- 2) apply #1 ---
        Log("POST /api/pdm-import/apply (первый раз) …");
        JsonElement apply1;
        try
        {
            using var a1 = site.ApplyAsync(planId, decisions, tree).GetAwaiter().GetResult();
            apply1 = a1.RootElement.Clone();
        }
        catch (SiteException ex)
        {
            Log($"ОШИБКА СЕРВЕРА apply#1: {ex.StatusCode} {ex.Message}");
            WriteReport(samples, report);
            return 2;
        }
        File.WriteAllText(Path.Combine(samples, "6104.apply-1.json"), apply1.GetRawText(), Encoding.UTF8);
        Log($"apply#1 created={Num(apply1, "created")} linked={Num(apply1, "linked")} updated={Num(apply1, "updated")} skipped={Num(apply1, "skipped")}");
        string importId = Str(apply1, "importId") ?? planId;

        // --- 3) files ---
        var need = ShaList(apply1, "needFiles");
        if (need.Count == 0 && preview.TryGetProperty("needFiles", out var pnf))
            need = ShaList(preview, "needFiles");
        Log($"needFiles: {need.Count}");
        int uploaded = UploadNeeded(site, tree, importId, need, Log);
        Log($"Файлов загружено: {uploaded}");
        int pics = UploadPreviews(site, tree, importId, Log);
        Log($"Картинок загружено: {pics}");

        // --- 4) preview + apply #2 ---
        Log("Повтор: preview + apply …");
        using var preview2Doc = site.PreviewAsync(tree).GetAwaiter().GetResult();
        var preview2 = preview2Doc.RootElement.Clone();
        File.WriteAllText(Path.Combine(samples, "6104.preview-2.json"), preview2.GetRawText(), Encoding.UTF8);
        string planId2 = preview2.GetProperty("planId").GetString()!;
        var decisions2 = BuildDecisions(preview2);
        JsonElement apply2;
        try
        {
            using var a2 = site.ApplyAsync(planId2, decisions2, tree).GetAwaiter().GetResult();
            apply2 = a2.RootElement.Clone();
        }
        catch (SiteException ex)
        {
            Log($"ОШИБКА СЕРВЕРА apply#2: {ex.StatusCode} {ex.Message}");
            WriteReport(samples, report);
            return 2;
        }
        File.WriteAllText(Path.Combine(samples, "6104.apply-2.json"), apply2.GetRawText(), Encoding.UTF8);
        Log($"apply#2 created={Num(apply2, "created")} linked={Num(apply2, "linked")} updated={Num(apply2, "updated")} skipped={Num(apply2, "skipped")}");

        // --- 5) найти изделие и purchase-needs ---
        string? productId = FindProductId(site, "6104.0000.0000", Log);
        if (productId != null)
        {
            try
            {
                var needsJson = site.GetRawAsync($"/api/products/{productId}/purchase-needs?qty=1").GetAwaiter().GetResult();
                File.WriteAllText(Path.Combine(samples, "6104.purchase-needs.json"), needsJson, Encoding.UTF8);
                Log($"purchase-needs → samples/6104.purchase-needs.json ({needsJson.Length} байт)");
            }
            catch (SiteException ex)
            {
                Log($"ОШИБКА СЕРВЕРА purchase-needs: {ex.StatusCode} {ex.Message}");
            }
        }
        else Log("ОШИБКА: изделие 6104.0000.0000 на сайте не найдено");

        // --- 6) pdm-files для 0019 ---
        string? matId = FindMaterialId(site, "0000.0000.0019", Log);
        if (matId != null)
        {
            try
            {
                var filesJson = site.GetRawAsync($"/api/pdm-files?ownerKind=material&ownerId={matId}").GetAwaiter().GetResult();
                File.WriteAllText(Path.Combine(samples, "6104.0019.pdm-files.json"), filesJson, Encoding.UTF8);
                Log($"pdm-files 0019 → samples/6104.0019.pdm-files.json");
                using var fd = JsonDocument.Parse(filesJson);
                var arr = fd.RootElement.ValueKind == JsonValueKind.Array ? fd.RootElement
                    : fd.RootElement.TryGetProperty("items", out var it) ? it : default;
                if (arr.ValueKind == JsonValueKind.Array)
                {
                    foreach (var f in arr.EnumerateArray())
                    {
                        var kind = Str(f, "docKind") ?? Str(f, "type") ?? "";
                        var ver = f.TryGetProperty("pdmVersion", out var v) ? v.ToString() : Str(f, "version");
                        var cur = f.TryGetProperty("isCurrent", out var c) && c.ValueKind == JsonValueKind.True;
                        Log($"  файл: {kind} v{ver} current={cur} name={Str(f, "name")}");
                    }
                }
            }
            catch (SiteException ex)
            {
                Log($"ОШИБКА СЕРВЕРА pdm-files: {ex.StatusCode} {ex.Message}");
            }
        }
        else Log("ОШИБКА: материал 0000.0000.0019 на сайте не найден");

        WriteReport(samples, report);
        bool okSecond = Num(apply2, "created") == 0;
        Log(okSecond ? "ИТОГ: повторная загрузка без новых — ок" : "ИТОГ: повторная загрузка создала новые — см. отчёт");
        return okSecond ? 0 : 2;
    }

    static Dictionary<string, DecisionDto> BuildDecisions(JsonElement preview)
    {
        var decisions = new Dictionary<string, DecisionDto>(StringComparer.OrdinalIgnoreCase);
        if (!preview.TryGetProperty("items", out var items)) return decisions;
        foreach (var it in items.EnumerateArray())
        {
            var des = Str(it, "designation");
            if (des == null) continue;
            var action = Str(it, "action") ?? "create";
            var d = new DecisionDto();
            switch (action)
            {
                case "create":
                    d.action = "create";
                    break;
                case "link":
                case "same":
                    d.action = action == "same" ? "keep-site" : "link";
                    if (it.TryGetProperty("targetId", out var tid) && tid.ValueKind == JsonValueKind.String)
                        d.targetId = tid.GetString();
                    break;
                case "conflict":
                    d.action = "update-all";
                    var fields = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                    if (it.TryGetProperty("fields", out var fl) && fl.ValueKind == JsonValueKind.Array)
                        foreach (var f in fl.EnumerateArray())
                        {
                            var name = Str(f, "field");
                            if (name != null) fields[name] = "pdm";
                        }
                    if (fields.Count > 0) d.fields = fields;
                    break;
                case "suggest":
                    if (it.TryGetProperty("candidates", out var cands) && cands.GetArrayLength() > 0)
                    {
                        d.action = "link";
                        d.targetId = Str(cands[0], "id");
                    }
                    else d.action = "create";
                    break;
                default:
                    d.action = "create";
                    break;
            }
            decisions[des] = d;
        }
        return decisions;
    }

    static int UploadNeeded(SiteClient site, PdmTree tree, string importId, List<string> need, Action<string> log)
    {
        if (need.Count == 0) return 0;
        var bySha = tree.Items.SelectMany(i => i.Docs.Select(d => (Item: i, Doc: d)))
            .Where(x => !string.IsNullOrEmpty(x.Doc.Sha256))
            .GroupBy(x => x.Doc.Sha256, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        int ok = 0;
        foreach (var sha in need)
        {
            if (!bySha.TryGetValue(sha, out var pair))
            {
                log($"  нет локального файла для sha {sha[..8]}…");
                continue;
            }
            var local = Directory.EnumerateFiles(AppPaths.Cache, pair.Doc.Name, SearchOption.AllDirectories).FirstOrDefault();
            if (local == null)
            {
                log($"  нет в кэше: {pair.Doc.Name}");
                continue;
            }
            try
            {
                site.UploadFileAsync(importId, pair.Item.Designation, pair.Doc.Type, pair.Doc.Name,
                    pair.Doc.PdmFileId, pair.Doc.Version, pair.Doc.State, pair.Doc.Modified, pair.Doc.Sha256, local)
                    .GetAwaiter().GetResult();
                ok++;
                log($"  файл ок: {pair.Doc.Name}");
            }
            catch (Exception ex)
            {
                log($"  файл ошибка {pair.Doc.Name}: {ex.Message}");
            }
        }
        return ok;
    }

    /// <summary>После apply: PNG из previews/ → POST /pdm-import/preview-image. 404 = сервер ещё без эндпоинта.</summary>
    static int UploadPreviews(SiteClient site, PdmTree tree, string importId, Action<string> log)
    {
        int ok = 0;
        foreach (var it in tree.Items.Where(x => !string.IsNullOrEmpty(x.Preview)))
        {
            var name = Path.GetFileName(it.Preview!);
            var local = Directory.EnumerateFiles(AppPaths.CacheFor("previews"), name, SearchOption.AllDirectories).FirstOrDefault()
                ?? Directory.EnumerateFiles(AppPaths.Cache, name, SearchOption.AllDirectories).FirstOrDefault();
            if (local == null)
            {
                log($"  нет превью в кэше: {name}");
                continue;
            }
            try
            {
                using var fs = File.OpenRead(local);
                var sha = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(fs)).ToLowerInvariant();
                site.UploadPreviewImageAsync(importId, it.Designation, sha, local).GetAwaiter().GetResult();
                ok++;
                log($"  картинка ок: {it.Designation}");
            }
            catch (SiteException ex) when (ex.StatusCode == 404)
            {
                log("  картинки: сайт ещё без POST /pdm-import/preview-image (жду выкладки координатора)");
                break;
            }
            catch (Exception ex)
            {
                log($"  картинка ошибка {it.Designation}: {ex.Message}");
            }
        }
        return ok;
    }

    static string? FindProductId(SiteClient site, string designation, Action<string> log)
    {
        try
        {
            // типичные фильтры списка изделий
            foreach (var path in new[]
                     {
                         $"/api/products?search={Uri.EscapeDataString(designation)}&limit=20",
                         $"/api/products?sku={Uri.EscapeDataString(designation)}&limit=20",
                         $"/api/products?q={Uri.EscapeDataString(designation)}&limit=20",
                     })
            {
                try
                {
                    var raw = site.GetRawAsync(path).GetAwaiter().GetResult();
                    using var doc = JsonDocument.Parse(raw);
                    var items = doc.RootElement.TryGetProperty("items", out var it) ? it : doc.RootElement;
                    if (items.ValueKind != JsonValueKind.Array) continue;
                    foreach (var p in items.EnumerateArray())
                    {
                        var sku = Str(p, "sku") ?? Str(p, "article") ?? "";
                        if (sku.Equals(designation, StringComparison.OrdinalIgnoreCase))
                            return Str(p, "id") ?? (p.TryGetProperty("_id", out var id) ? id.ToString() : null);
                    }
                }
                catch (SiteException ex) { log($"  поиск изделия {path}: {ex.StatusCode}"); }
            }
        }
        catch (Exception ex) { log("  поиск изделия: " + ex.Message); }
        return null;
    }

    static string? FindMaterialId(SiteClient site, string designation, Action<string> log)
    {
        try
        {
            // из ответа «Что купить» — missingBlank уже содержит id деталей
            var needsPath = Path.Combine(FindSamplesDir(), "6104.purchase-needs.json");
            if (File.Exists(needsPath))
            {
                using var nd = JsonDocument.Parse(File.ReadAllText(needsPath));
                if (nd.RootElement.TryGetProperty("missingBlank", out var mb) && mb.ValueKind == JsonValueKind.Array)
                {
                    foreach (var p in mb.EnumerateArray())
                    {
                        var art = Str(p, "article") ?? Str(p, "name") ?? "";
                        if (art.Equals(designation, StringComparison.OrdinalIgnoreCase))
                            return Str(p, "id") ?? (p.TryGetProperty("_id", out var id) ? id.ToString() : null);
                    }
                }
            }

            foreach (var path in new[]
                     {
                         $"/api/materials?search={Uri.EscapeDataString(designation)}&limit=50&materialKind=part",
                         $"/api/materials?limit=200&materialKind=part",
                     })
            {
                try
                {
                    var raw = site.GetRawAsync(path).GetAwaiter().GetResult();
                    using var doc = JsonDocument.Parse(raw);
                    var items = doc.RootElement.TryGetProperty("items", out var it) ? it : doc.RootElement;
                    if (items.ValueKind != JsonValueKind.Array) continue;
                    foreach (var p in items.EnumerateArray())
                    {
                        var art = Str(p, "article") ?? Str(p, "pdmCode") ?? "";
                        if (art.Equals(designation, StringComparison.OrdinalIgnoreCase))
                            return Str(p, "id") ?? (p.TryGetProperty("_id", out var id) ? id.ToString() : null);
                    }
                }
                catch (SiteException ex) { log($"  поиск материала {path}: {ex.StatusCode}"); }
            }
        }
        catch (Exception ex) { log("  поиск материала: " + ex.Message); }
        return null;
    }

    static string? ReadAdminPasswordFromEnv()
    {
        try
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                var env = Path.Combine(dir.FullName, ".env");
                if (File.Exists(env))
                {
                    foreach (var line in File.ReadAllLines(env))
                    {
                        if (line.StartsWith("ADMIN_PASSWORD=", StringComparison.OrdinalIgnoreCase))
                            return line["ADMIN_PASSWORD=".Length..].Trim().Trim('"');
                    }
                }
                dir = dir.Parent;
            }
        }
        catch { /* */ }
        return null;
    }

    static void WriteReport(string samples, StringBuilder report)
    {
        var path = Path.Combine(samples, "6104.stand-run.txt");
        File.WriteAllText(path, report.ToString(), Encoding.UTF8);
        Console.WriteLine("лог прогона: " + path);
    }

    static List<string> ShaList(JsonElement root, string name)
    {
        var list = new List<string>();
        if (!root.TryGetProperty(name, out var a) || a.ValueKind != JsonValueKind.Array) return list;
        foreach (var x in a.EnumerateArray())
            if (x.ValueKind == JsonValueKind.String) list.Add(x.GetString()!);
        return list;
    }

    static int Num(JsonElement e, string name) =>
        e.TryGetProperty(name, out var p) && p.TryGetInt32(out var n) ? n : 0;

    static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    static string FindSamplesDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            var crew = Path.Combine(dir.FullName, "docs", "crew", "C057-pdm-import");
            if (Directory.Exists(crew))
            {
                var cand = Path.Combine(crew, "samples");
                Directory.CreateDirectory(cand);
                return cand;
            }
            dir = dir.Parent;
        }
        var fallback = Path.Combine(AppPaths.Root, "samples");
        Directory.CreateDirectory(fallback);
        return fallback;
    }
}
