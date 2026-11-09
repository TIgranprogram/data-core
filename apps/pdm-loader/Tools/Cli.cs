using System.Text;
using System.Text.Json;
using DataCore.PdmLoader.Pdm;

namespace DataCore.PdmLoader.Tools;

public static class Cli
{
    public static int Run(string[] args)
    {
        // DataCore.PdmLoader.exe check-6104 [--json path] [--etalon path]
        // DataCore.PdmLoader.exe export-6104 [--out path] [--no-files]
        Directory.CreateDirectory(AppPaths.Logs);
        var logFile = Path.Combine(AppPaths.Logs, $"cli-{DateTime.Now:yyyyMMdd-HHmmss}.log");
        var marker = Path.Combine(AppPaths.Logs, "last-cli.txt");
        using var fs = new FileStream(logFile, FileMode.Create, FileAccess.ReadWrite, FileShare.ReadWrite);
        using var writer = new StreamWriter(fs) { AutoFlush = true };
        var oldOut = Console.Out;
        var oldErr = Console.Error;
        Console.SetOut(writer);
        Console.SetError(writer);
        Console.WriteLine("log=" + logFile);
        int code = 2;
        try
        {
            string cmd = args[0].ToLowerInvariant();
            var map = ParseFlags(args.Skip(1).ToArray());
            code = cmd switch
            {
                "check-6104" => Check6104(map),
                "export-6104" => Export6104(map),
                "list-vaults" => ListVaults(),
                "dump-bom" => DumpBom(map),
                "dump-vars" => DumpVars(map),
                "dump-blank" => DumpBlank(map),
                _ => Help(),
            };
            return code;
        }
        finally
        {
            writer.Flush();
            fs.Flush();
            try
            {
                fs.Position = 0;
                using var sr = new StreamReader(fs, leaveOpen: true);
                File.WriteAllText(marker, sr.ReadToEnd());
            }
            catch { File.WriteAllText(marker, "см. " + logFile); }
            Console.SetOut(oldOut);
            Console.SetError(oldErr);
            Console.WriteLine("код=" + code + " лог=" + logFile);
        }
    }

    static int Help()
    {
        Console.WriteLine("""
            Команды:
              check-6104 [--etalon путь.xlsx] [--json путь.json]
              export-6104 [--out путь.json] [--no-files]
              list-vaults
            """);
        return 1;
    }

    static Dictionary<string, string?> ParseFlags(string[] args)
    {
        var d = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        for (int i = 0; i < args.Length; i++)
        {
            var a = args[i];
            if (!a.StartsWith("--")) continue;
            var key = a[2..];
            string? val = null;
            if (i + 1 < args.Length && !args[i + 1].StartsWith("--")) { val = args[++i]; }
            d[key] = val ?? "1";
        }
        return d;
    }

    static int ListVaults()
    {
        foreach (var v in VaultSession.ListVaults())
            Console.WriteLine($"{v.Name}\t{v.Location}");
        return 0;
    }

    static int DumpBom(Dictionary<string, string?> flags)
    {
        using var session = VaultSession.LoginAuto();
        var hit = PdmSearch.FindAssembly(session, flags.GetValueOrDefault("des") ?? "6104.0000.0000")
            ?? throw new InvalidOperationException("не найдено");
        BomReader.DumpDebug(session, hit.File, Console.WriteLine);
        return 0;
    }

    static int DumpBlank(Dictionary<string, string?> flags)
    {
        using var session = VaultSession.LoginAuto();
        string des = flags.GetValueOrDefault("des") ?? "0000.0000.0019";
        var dxfs = PdmSearch.FindByDesignation(session, des, ".dxf");
        Console.WriteLine("dxf hits=" + dxfs.Count);
        if (dxfs.Count == 0) return 2;
        var copy = PdmCopy.GetLatestCopy(dxfs[0].File, AppPaths.CacheFor(des + "_dxf"))
            ?? throw new InvalidOperationException("copy failed");
        Console.WriteLine("local=" + copy.LocalPath);
        var m = DxfBlank.Measure(copy.LocalPath);
        Console.WriteLine(m == null ? "measure=null" : $"blank={m.Value.Length} x {m.Value.Width}");
        return m == null ? 2 : 0;
    }

    static int DumpVars(Dictionary<string, string?> flags)
    {
        using var session = VaultSession.LoginAuto();
        string des = flags.GetValueOrDefault("des") ?? "0000.0000.0019";
        var hits = PdmSearch.FindByDesignation(session, des, ".sldprt", ".sldasm");
        if (hits.Count == 0) { Console.WriteLine("не найдено"); return 2; }
        var hit = hits[0];
        Console.WriteLine("path=" + hit.Path);
        dynamic file = hit.File;
        dynamic ev = file.GetEnumeratorVariable();
        string[] names =
        [
            "Вид_изделия", "Вид изделия", "Сортамент", "Сортамент, ГОСТ", "Материал",
            "Длина", "Ширина", "Толщина", "Масса", "Number", "RAL", "Длина_заготовки",
            "Описание", "Description", "Title",
        ];
        string[] cfgs = ["00 Стандартная", "00", "", "Default", "Стандартная"];
        try
        {
            object[]? cfgNames = null;
            file.GetConfigurationNames(out cfgNames);
            if (cfgNames != null)
                Console.WriteLine("configs: " + string.Join(" | ", cfgNames.OfType<string>()));
        }
        catch (Exception ex) { Console.WriteLine("cfg err: " + ex.Message); }

        foreach (var n in names)
        {
            foreach (var c in cfgs)
            {
                try
                {
                    object? val = null;
                    ev.GetVar(n, c, out val);
                    var s = Convert.ToString(val);
                    if (!string.IsNullOrWhiteSpace(s) && s != "0")
                    {
                        Console.WriteLine($"OK [{c}] {n} = {s}");
                        break;
                    }
                }
                catch { /* next */ }
            }
        }

        try
        {
            dynamic vault7 = session.Vault;
            dynamic mgr = vault7.CreateUtility(EPDM.Interop.epdm.EdmUtility.EdmUtil_VariableMgr);
            object[]? arr = null;
            try { mgr.GetVariableNames(out arr); }
            catch
            {
                try { arr = mgr.GetVariableNames(); } catch { /* */ }
            }
            Console.WriteLine("vault vars: " + (arr == null ? 0 : arr.Length));
            if (arr != null)
                foreach (var o in arr.OfType<string>().OrderBy(x => x).Take(100))
                    Console.WriteLine("  var: " + o);
        }
        catch (Exception ex) { Console.WriteLine("varmgr: " + ex.Message); }
        return 0;
    }

    static int Check6104(Dictionary<string, string?> flags)
    {
        Console.OutputEncoding = Encoding.UTF8;
        using var session = VaultSession.LoginAuto();
        Console.WriteLine($"Хранилище: {session.Name}");

        Dictionary<string, double> leafs;
        Dictionary<string, IReadOnlyList<string>>? aliases = null;
        if (flags.TryGetValue("json", out var jp) && !string.IsNullOrWhiteSpace(jp) && File.Exists(jp))
        {
            (leafs, aliases) = LeafsAndAliasesFromJson(jp!);
        }
        else
        {
            var b = new TreeBuilder(session, IntPtr.Zero, msg => Console.WriteLine(msg));
            var tree = b.Build("6104.0000.0000", withFiles: false, withBlanks: true);
            leafs = new Dictionary<string, double>(b.LeafTotals, StringComparer.OrdinalIgnoreCase);
            aliases = tree.Items.ToDictionary(
                i => i.Designation,
                i => (IReadOnlyList<string>)(i.Aliases ?? []),
                StringComparer.OrdinalIgnoreCase);
            var sampleDir = FindSamplesDir();
            Directory.CreateDirectory(sampleDir);
            var jsonPath = Path.Combine(sampleDir, "6104.pdm-tree.json");
            File.WriteAllText(jsonPath, TreeBuilder.ToJson(tree), Encoding.UTF8);
            Console.WriteLine($"Дерево: {jsonPath}, позиций: {tree.Items.Count}, связей: {tree.Bom.Count}");
        }

        string etalon = flags.GetValueOrDefault("etalon") ?? "";
        if (string.IsNullOrWhiteSpace(etalon) || !File.Exists(etalon))
            etalon = EtalonCheck.FetchEtalonXlsx(session);

        var res = EtalonCheck.Compare(leafs, etalon, aliases);
        Console.WriteLine(res.ReportText);
        var reportPath = Path.Combine(AppPaths.Logs, $"check-6104-{DateTime.Now:yyyyMMdd-HHmmss}.txt");
        File.WriteAllText(reportPath, res.ReportText, Encoding.UTF8);
        Console.WriteLine($"Отчёт: {reportPath}");
        return res.Matched == res.Total && res.Missing == 0 && res.QtyMismatch == 0 ? 0 : 2;
    }

    static int Export6104(Dictionary<string, string?> flags)
    {
        using var session = VaultSession.LoginAuto();
        bool files = !flags.ContainsKey("no-files");
        var b = new TreeBuilder(session, IntPtr.Zero, Console.WriteLine);
        var tree = b.Build("6104.0000.0000", withFiles: files);
        string outPath = flags.GetValueOrDefault("out") ?? Path.Combine(FindSamplesDir(), "6104.pdm-tree.json");
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);
        File.WriteAllText(outPath, TreeBuilder.ToJson(tree), Encoding.UTF8);
        Console.WriteLine($"Записано: {outPath}");
        Console.WriteLine($"items={tree.Items.Count} bom={tree.Bom.Count} warnings={tree.Warnings.Count}");
        return 0;
    }

    static (Dictionary<string, double> Leafs, Dictionary<string, IReadOnlyList<string>> Aliases) LeafsAndAliasesFromJson(string path)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(path).TrimStart('\uFEFF'));
        var root = doc.RootElement.GetProperty("root").GetString()!;
        var bom = new List<(string P, string C, double Q)>();
        foreach (var e in doc.RootElement.GetProperty("bom").EnumerateArray())
            bom.Add((e.GetProperty("parent").GetString()!, e.GetProperty("child").GetString()!, e.GetProperty("qty").GetDouble()));

        var children = bom.GroupBy(x => x.P, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);
        var leafs = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        void Walk(string n, double m)
        {
            if (!children.TryGetValue(n, out var list))
            {
                leafs[n] = leafs.GetValueOrDefault(n) + m;
                return;
            }
            foreach (var x in list) Walk(x.C, m * x.Q);
        }
        Walk(root, 1);
        leafs.Remove(root);

        var aliases = new Dictionary<string, IReadOnlyList<string>>(StringComparer.OrdinalIgnoreCase);
        if (doc.RootElement.TryGetProperty("items", out var items))
        {
            foreach (var e in items.EnumerateArray())
            {
                var des = e.GetProperty("designation").GetString()!;
                var list = new List<string>();
                if (e.TryGetProperty("aliases", out var al) && al.ValueKind == JsonValueKind.Array)
                    foreach (var a in al.EnumerateArray())
                        if (a.GetString() is { } s) list.Add(s);
                if (e.TryGetProperty("vars", out var vars) && vars.ValueKind == JsonValueKind.Object
                    && vars.TryGetProperty("Number", out var num) && num.GetString() is { } n
                    && !string.IsNullOrWhiteSpace(n) && !list.Contains(n, StringComparer.OrdinalIgnoreCase))
                    list.Add(n);
                aliases[des] = list;
            }
        }
        return (leafs, aliases);
    }

    static string FindSamplesDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            var cand = Path.Combine(dir.FullName, "docs", "crew", "C057-pdm-import", "samples");
            if (Directory.Exists(Path.Combine(dir.FullName, "docs", "crew", "C057-pdm-import")))
            {
                Directory.CreateDirectory(cand);
                return cand;
            }
            // apps/pdm-loader
            cand = Path.Combine(dir.FullName, "..", "..", "docs", "crew", "C057-pdm-import", "samples");
            cand = Path.GetFullPath(cand);
            if (Directory.Exists(Path.GetDirectoryName(cand)))
            {
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
