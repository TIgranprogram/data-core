namespace DataCore.PdmLoader.Pdm;

public static class AppPaths
{
    public static string Root =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DataCore", "PdmLoader");

    public static string Logs => Dir("logs");
    public static string Cache => Dir("cache");
    public static string Temp => Dir("temp");

    static string Dir(string name)
    {
        var p = Path.Combine(Root, name);
        Directory.CreateDirectory(p);
        return p;
    }

    public static string CacheFor(string designationOrKey)
    {
        var safe = string.Concat(designationOrKey.Select(c => char.IsLetterOrDigit(c) || c is '.' or '-' or '_' ? c : '_'));
        var p = Path.Combine(Cache, safe);
        Directory.CreateDirectory(p);
        return p;
    }

    public static void CleanOldCache(int days = 30)
    {
        var cut = DateTime.UtcNow.AddDays(-days);
        if (!Directory.Exists(Cache)) return;
        foreach (var d in Directory.EnumerateDirectories(Cache))
        {
            try
            {
                if (Directory.GetLastWriteTimeUtc(d) < cut) Directory.Delete(d, true);
            }
            catch { /* занято */ }
        }
    }
}
