using System.Globalization;
using System.Runtime.Versioning;
using EPDM.Interop.epdm;

namespace DataCore.PdmLoader.Pdm;

[SupportedOSPlatform("windows")]
public static class Variables
{
    /// <summary>Каноническое имя → варианты имени переменной в разных хранилищах.</summary>
    static readonly (string Canon, string[] Aliases)[] VarMap =
    [
        ("Вид_изделия", ["Вид_изделия", "Вид изделия", "ВидИзделия"]),
        ("Сортамент", ["Сортамент", "Сортамент, ГОСТ", "Сортамент ГОСТ"]),
        ("Материал", ["Материал"]),
        ("Длина", ["Длина"]),
        ("Ширина", ["Ширина"]),
        ("Толщина", ["Толщина"]),
        ("Длина_заготовки", ["Длина_заготовки", "Длина заготовки"]),
        ("Масса", ["Масса", "Weight", "SW-Mass"]),
        ("Number", ["Number", "Номер", "Обозначение"]),
        ("RAL", ["RAL", "Цвет", "Цвет (RAL)"]),
        ("Описание", ["Описание", "Description", "Title"]),
    ];

    /// <summary>
    /// Читает переменные карточки: сначала конфигурация родителя (BOM),
    /// пустое значение → общие свойства файла «@» (C057-Э2в).
    /// </summary>
    public static Dictionary<string, string?> Read(IEdmFile5 file, string? config)
    {
        var map = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        dynamic? ev = null;
        try { ev = ((dynamic)file).GetEnumeratorVariable(); } catch { }
        if (ev == null)
        {
            try { ev = ((dynamic)file).GetEnumeratorVariables(); } catch { }
        }
        if (ev == null) return map;

        // Порядок: конфигурация, на которую ссылается родитель → «@».
        var configs = new List<string>();
        if (!string.IsNullOrWhiteSpace(config) && !config.Equals("@", StringComparison.Ordinal))
            configs.Add(config!);
        configs.Add("@");

        foreach (var (canon, aliases) in VarMap)
        {
            string? found = null;
            foreach (var name in aliases)
            {
                foreach (var cfg in configs)
                {
                    try
                    {
                        object? val = null;
                        ev.GetVar(name, cfg, out val);
                        found = Norm(val);
                        if (found != null) break;
                    }
                    catch { /* next */ }
                }
                if (found != null) break;
            }
            map[canon] = found;
        }
        return map;
    }

    static string? Norm(object? val)
    {
        if (val == null) return null;
        var s = Convert.ToString(val, CultureInfo.InvariantCulture)?.Trim();
        if (string.IsNullOrWhiteSpace(s) || s == "0" || s == "0.0" || s == "0,0") return null;
        if (double.TryParse(s.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var d)
            && s.Any(char.IsDigit) && !s.Any(char.IsLetter))
            return d.ToString(CultureInfo.InvariantCulture);
        return s;
    }

    public static string KindFromPdm(string? pdmKind, bool promote)
    {
        if (promote) return "promote";
        var k = (pdmKind ?? "").Trim();
        return k switch
        {
            "Изделие" => "product",
            "Модуль" => "module",
            "Деталь" => "part",
            "Метиз" => "fastener",
            "Покупное изделие" => "purchased",
            "Сборочный модуль" => "module",
            "Соединение" => "module",
            _ => "part",
        };
    }

    /// <summary>Запасной вид по папке PDM, если переменная пуста.</summary>
    public static string? KindFromPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var p = path.Replace('/', '\\');
        if (p.Contains("\\4 Метизы", StringComparison.OrdinalIgnoreCase) || p.Contains("\\Метизы\\", StringComparison.OrdinalIgnoreCase))
            return "fastener";
        if (p.Contains("\\5 Покупные", StringComparison.OrdinalIgnoreCase) || p.Contains("\\Покупные", StringComparison.OrdinalIgnoreCase))
            return "purchased";
        if (p.Contains("\\3 Модули", StringComparison.OrdinalIgnoreCase) || p.Contains("\\Модули\\", StringComparison.OrdinalIgnoreCase))
            return "module";
        if (p.Contains("\\1 Изделия", StringComparison.OrdinalIgnoreCase) || p.Contains("\\Изделия\\", StringComparison.OrdinalIgnoreCase))
            return "product";
        if (p.Contains("\\2 Детали", StringComparison.OrdinalIgnoreCase) || p.Contains("\\Детали\\", StringComparison.OrdinalIgnoreCase))
            return "part";
        return null;
    }

    public static string? PdmKindLabel(string kind) => kind switch
    {
        "product" => "Изделие",
        "module" => "Модуль",
        "part" => "Деталь",
        "fastener" => "Метиз",
        "purchased" => "Покупное изделие",
        _ => null,
    };

    public static double? Num(Dictionary<string, string?> vars, string key)
    {
        if (!vars.TryGetValue(key, out var s) || string.IsNullOrWhiteSpace(s)) return null;
        return double.TryParse(s.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : null;
    }
}
