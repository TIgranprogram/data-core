using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using EPDM.Interop.epdm;
using Microsoft.Win32;

namespace DataCore.PdmLoader.Pdm;

[SupportedOSPlatform("windows")]
public sealed class VaultSession : IDisposable
{
    public IEdmVault5 Vault { get; }
    public string Name { get; }
    public string RootPath { get; }
    public int RootFolderId { get; }

    VaultSession(IEdmVault5 vault, string name, string rootPath, int rootFolderId)
    {
        Vault = vault;
        Name = name;
        RootPath = rootPath;
        RootFolderId = rootFolderId;
    }

    public static IReadOnlyList<(string Name, string Location)> ListVaults()
    {
        var found = new List<(string, string)>();
        string[] keys =
        [
            @"SOFTWARE\SolidWorks\Applications\PDMWorks Enterprise\Databases",
            @"SOFTWARE\WOW6432Node\SolidWorks\Applications\PDMWorks Enterprise\Databases",
        ];
        foreach (var hive in new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser })
        {
            foreach (var sub in keys)
            {
                foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
                {
                    try
                    {
                        using var baseKey = RegistryKey.OpenBaseKey(hive, view);
                        using var key = baseKey.OpenSubKey(sub);
                        if (key == null) continue;
                        foreach (var name in key.GetSubKeyNames())
                        {
                            if (found.Any(f => f.Item1.Equals(name, StringComparison.OrdinalIgnoreCase))) continue;
                            using var vk = key.OpenSubKey(name);
                            string loc = "";
                            foreach (var val in new[] { "Location", "Path", "LocalPath" })
                            {
                                var o = vk?.GetValue(val) as string;
                                if (!string.IsNullOrWhiteSpace(o)) { loc = o; break; }
                            }
                            found.Add((name, loc));
                        }
                    }
                    catch { /* нет ветки */ }
                }
            }
        }
        return found;
    }

    /// <summary>Вход Windows в хранилище. Одно — выбираем само; несколько — «PDM» или первое.</summary>
    public static VaultSession LoginAuto(IntPtr hwnd = default)
    {
        var views = ListVaults();
        if (views.Count == 0)
            throw new InvalidOperationException("Клиент SOLIDWORKS PDM не найден. Установите клиент и войдите в хранилище.");

        string pick = views.Any(v => v.Name.Equals("PDM", StringComparison.OrdinalIgnoreCase))
            ? "PDM"
            : views[0].Name;

        var vault = (IEdmVault5)new EdmVault5();
        vault.LoginAuto(pick, (int)hwnd);
        if (!vault.IsLoggedIn)
            throw new InvalidOperationException($"Не удалось войти в хранилище «{pick}».");

        var root = vault.RootFolder as IEdmFolder5;
        string rootPath = "";
        int rootId = vault.RootFolderID;
        try { rootPath = root?.LocalPath ?? ""; } catch { /* */ }
        var loc = views.FirstOrDefault(v => v.Name.Equals(pick, StringComparison.OrdinalIgnoreCase)).Location;
        if (string.IsNullOrWhiteSpace(rootPath)) rootPath = loc ?? "";

        return new VaultSession(vault, pick, rootPath, rootId);
    }

    public void Dispose()
    {
        try
        {
            if (Vault.IsLoggedIn)
            {
                try { ((dynamic)Vault).Logout(); } catch { }
            }
        }
        catch { /* */ }
        if (Vault is IDisposable d) d.Dispose();
        else if (Marshal.IsComObject(Vault)) Marshal.FinalReleaseComObject(Vault);
    }
}
