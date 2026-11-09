using System.Runtime.Versioning;
using EPDM.Interop.epdm;

namespace DataCore.PdmLoader.Pdm;

[SupportedOSPlatform("windows")]
public static class PdmSearch
{
    public sealed record Hit(IEdmFile5 File, IEdmFolder5 Folder, string Path, string Name);

    /// <summary>Ищет файл «&lt;номер&gt;.%» рекурсивно. Предпочитает .SLDASM.</summary>
    public static Hit? FindAssembly(VaultSession session, string designation, Action<string>? progress = null)
    {
        progress?.Invoke($"Ищу «{designation}» в хранилище…");
        var search = (IEdmSearch5)session.Vault.CreateSearch();
        search.FileName = designation + ".%";
        try { search.FindFiles = true; } catch { }
        try { search.FindFolders = false; } catch { }
        try { ((dynamic)search).Recursive = true; } catch { }
        try { search.StartFolderID = session.RootFolderId; } catch { }

        Hit? asm = null;
        Hit? any = null;
        var res = search.GetFirstResult();
        int guard = 0;
        while (res != null && guard++ < 2000)
        {
            string path = res.Path ?? "";
            string name = Path.GetFileName(path);
            string stem = Path.GetFileNameWithoutExtension(name);
            string ext = Path.GetExtension(name).ToLowerInvariant();
            if (!stem.Equals(designation, StringComparison.OrdinalIgnoreCase)
                && !stem.StartsWith(designation + "^", StringComparison.OrdinalIgnoreCase))
            {
                res = search.GetNextResult();
                continue;
            }

            IEdmFolder5? folder = null;
            IEdmFile5? file = null;
            try
            {
                var pos = session.Vault.GetFileFromPath(path, out folder);
                file = pos;
            }
            catch
            {
                try { file = (IEdmFile5)res; } catch { }
            }

            if (file != null)
            {
                var hit = new Hit(file, folder!, path, name);
                any ??= hit;
                if (ext is ".sldasm") { asm = hit; break; }
            }
            res = search.GetNextResult();
        }

        return asm ?? any;
    }

    public static List<Hit> FindByDesignation(VaultSession session, string designation, params string[] extensions)
    {
        var list = new List<Hit>();
        var search = (IEdmSearch5)session.Vault.CreateSearch();
        search.FileName = designation + ".%";
        try { search.FindFiles = true; } catch { }
        try { search.FindFolders = false; } catch { }
        try { ((dynamic)search).Recursive = true; } catch { }
        try { search.StartFolderID = session.RootFolderId; } catch { }

        var want = new HashSet<string>(extensions.Select(e => e.StartsWith('.') ? e.ToLowerInvariant() : "." + e.ToLowerInvariant()));
        var res = search.GetFirstResult();
        int guard = 0;
        while (res != null && guard++ < 2000)
        {
            string path = res.Path ?? "";
            string name = Path.GetFileName(path);
            string stem = Path.GetFileNameWithoutExtension(name);
            string ext = Path.GetExtension(name).ToLowerInvariant();
            string stemClean = stem.Contains('^') ? stem.Split('^')[0] : stem;
            if (!stemClean.Equals(designation, StringComparison.OrdinalIgnoreCase))
            {
                res = search.GetNextResult();
                continue;
            }
            if (want.Count > 0 && !want.Contains(ext))
            {
                res = search.GetNextResult();
                continue;
            }

            IEdmFolder5? folder = null;
            IEdmFile5? file = null;
            try { file = session.Vault.GetFileFromPath(path, out folder); }
            catch { try { file = (IEdmFile5)res; } catch { } }
            if (file != null) list.Add(new Hit(file, folder!, path, name));
            res = search.GetNextResult();
        }
        return list;
    }
}
