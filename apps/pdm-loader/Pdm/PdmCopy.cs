using System.Runtime.Versioning;
using System.Security.Cryptography;
using EPDM.Interop.epdm;

namespace DataCore.PdmLoader.Pdm;

/// <summary>Копия файла во временную папку приложения. Локальный вид PDM не трогаем.</summary>
[SupportedOSPlatform("windows")]
public static class PdmCopy
{
    public sealed record Copied(string LocalPath, int Version, long Size, string Sha256, string? State, DateTime? Modified);

    public static Copied? GetLatestCopy(IEdmFile5 file, string destDir, IntPtr hwnd = default)
    {
        Directory.CreateDirectory(destDir);
        string name = file.Name;
        string dest = Path.Combine(destDir, name);
        int ver = 0;
        try { ver = file.CurrentVersion; } catch { }

        string mark = Path.Combine(destDir, "версия.txt");
        try
        {
            if (File.Exists(dest) && File.Exists(mark) && File.ReadAllText(mark).Trim() == ver.ToString())
                return Finish(dest, ver, file);
        }
        catch { /* */ }

        try
        {
            file.GetFileCopy((int)hwnd, 0, destDir, (int)EdmGetFlag.EdmGet_Simple, name);
        }
        catch (Exception ex)
        {
            // иногда копия оказывается в кэше приложения / рядом
            var alt = Directory.EnumerateFiles(AppPaths.Cache, name, SearchOption.AllDirectories).FirstOrDefault()
                ?? Directory.EnumerateFiles(destDir, name, SearchOption.AllDirectories).FirstOrDefault();
            if (alt != null && File.Exists(alt))
            {
                if (!alt.Equals(dest, StringComparison.OrdinalIgnoreCase))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                    File.Copy(alt, dest, true);
                }
            }
            else
                throw new InvalidOperationException($"Не удалось получить «{name}» из PDM: {ex.Message}", ex);
        }

        if (!File.Exists(dest))
        {
            var alt2 = Directory.EnumerateFiles(AppPaths.Cache, name, SearchOption.AllDirectories).FirstOrDefault();
            if (alt2 != null) { File.Copy(alt2, dest, true); }
        }
        if (!File.Exists(dest))
            throw new InvalidOperationException($"Файл «{name}» не появился во временной папке.");

        try
        {
            File.WriteAllText(mark, ver.ToString());
            try { File.SetAttributes(dest, FileAttributes.Normal); } catch { }
        }
        catch { /* */ }

        return Finish(dest, ver, file);
    }

    static Copied Finish(string dest, int ver, IEdmFile5 file)
    {
        string sha;
        using (var fs = File.OpenRead(dest))
            sha = Convert.ToHexString(SHA256.HashData(fs)).ToLowerInvariant();

        string? state = null;
        try { state = file.CurrentState?.Name; } catch { }

        DateTime? mod = null;
        try { mod = File.GetLastWriteTimeUtc(dest); } catch { }

        return new Copied(dest, ver, new FileInfo(dest).Length, sha, state, mod);
    }
}
