using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using EPDM.Interop.epdm;

namespace DataCore.PdmLoader.Pdm;

/// <summary>
/// Превью без SolidWorks: оболочка Windows (IShellItemImageFactory), иначе первая страница PDF (Windows.Data.Pdf).
/// PNG ≤ 800 px, в пакет как previews/&lt;обозначение&gt;.png.
/// </summary>
[SupportedOSPlatform("windows")]
public static class PreviewImage
{
    const int MaxPx = 800;

    public static string? BuildForItem(VaultSession session, PdmSearch.Hit? hit, string designation, IEnumerable<string> pdfLocalPaths, IntPtr hwnd = default)
    {
        Directory.CreateDirectory(AppPaths.CacheFor("previews"));
        string outPath = Path.Combine(AppPaths.CacheFor("previews"), designation + ".png");

        // 1) Превью файла PDM через оболочку Windows (для SLDPRT/PDF, если есть обработчик)
        if (hit != null)
        {
            try
            {
                var copy = PdmCopy.GetLatestCopy(hit.File, AppPaths.CacheFor(designation + "_preview_src"), hwnd);
                if (copy != null && TryShellThumbnail(copy.LocalPath, outPath))
                    return RelPreview(designation);
            }
            catch { /* дальше PDF */ }
        }

        foreach (var pdf in pdfLocalPaths)
        {
            if (string.IsNullOrWhiteSpace(pdf) || !File.Exists(pdf)) continue;
            if (TryShellThumbnail(pdf, outPath)) return RelPreview(designation);
            if (TryPdfFirstPage(pdf, outPath)) return RelPreview(designation);
        }
        return null;
    }

    static string RelPreview(string des) => $"previews/{des}.png";

    static bool TryShellThumbnail(string path, string outPng)
    {
        try
        {
            var bmp = ShellThumbnail.Get(path, MaxPx);
            if (bmp == null) return false;
            using (bmp)
            {
                using var scaled = Fit(bmp, MaxPx);
                scaled.Save(outPng, ImageFormat.Png);
            }
            return File.Exists(outPng) && new FileInfo(outPng).Length > 32;
        }
        catch { return false; }
    }

    static bool TryPdfFirstPage(string pdfPath, string outPng)
    {
        try
        {
            return PdfFirstPage.Render(pdfPath, outPng, MaxPx);
        }
        catch { return false; }
    }

    static Bitmap Fit(Bitmap src, int max)
    {
        int w = src.Width, h = src.Height;
        double scale = Math.Min(1.0, max / (double)Math.Max(w, h));
        int nw = Math.Max(1, (int)Math.Round(w * scale));
        int nh = Math.Max(1, (int)Math.Round(h * scale));
        var dst = new Bitmap(nw, nh, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(dst);
        g.Clear(Color.White);
        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        g.DrawImage(src, 0, 0, nw, nh);
        return dst;
    }
}

[SupportedOSPlatform("windows")]
static class ShellThumbnail
{
    public static Bitmap? Get(string path, int size)
    {
        var iid = typeof(IShellItemImageFactory).GUID;
        int hr = SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out IShellItemImageFactory factory);
        if (hr != 0 || factory == null) return null;
        try
        {
            var sz = new SIZE { cx = size, cy = size };
            factory.GetImage(sz, SIIGBF.SIIGBF_BIGGERSIZEOK | SIIGBF.SIIGBF_THUMBNAILONLY, out IntPtr hbitmap);
            if (hbitmap == IntPtr.Zero) return null;
            using var tmp = Image.FromHbitmap(hbitmap);
            DeleteObject(hbitmap);
            return new Bitmap(tmp);
        }
        catch { return null; }
        finally { Marshal.ReleaseComObject(factory); }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, out IShellItemImageFactory ppv);

    [DllImport("gdi32.dll")]
    static extern bool DeleteObject(IntPtr hObject);

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory
    {
        void GetImage(SIZE size, SIIGBF flags, out IntPtr phbm);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct SIZE { public int cx; public int cy; }

    [Flags]
    enum SIIGBF : uint
    {
        SIIGBF_BIGGERSIZEOK = 0x01,
        SIIGBF_THUMBNAILONLY = 0x08,
    }
}

/// <summary>Первая страница PDF через Windows.Data.Pdf (WinRT).</summary>
[SupportedOSPlatform("windows")]
static class PdfFirstPage
{
    public static bool Render(string pdfPath, string outPng, int maxPx)
    {
        // WinRT async → синхронно через .AsTask().GetAwaiter().GetResult()
        return RenderAsync(pdfPath, outPng, maxPx).GetAwaiter().GetResult();
    }

    static async Task<bool> RenderAsync(string pdfPath, string outPng, int maxPx)
    {
        try
        {
            var file = await Windows.Storage.StorageFile.GetFileFromPathAsync(pdfPath);
            var pdf = await Windows.Data.Pdf.PdfDocument.LoadFromFileAsync(file);
            if (pdf.PageCount < 1) return false;
            using var page = pdf.GetPage(0);
            var stream = new Windows.Storage.Streams.InMemoryRandomAccessStream();
            var opts = new Windows.Data.Pdf.PdfPageRenderOptions
            {
                DestinationWidth = (uint)Math.Min(maxPx, Math.Max(1, (int)page.Size.Width)),
            };
            await page.RenderToStreamAsync(stream, opts);
            stream.Seek(0);
            var reader = new Windows.Storage.Streams.DataReader(stream.GetInputStreamAt(0));
            await reader.LoadAsync((uint)stream.Size);
            var bytes = new byte[stream.Size];
            reader.ReadBytes(bytes);
            reader.Dispose();
            using var ms = new MemoryStream(bytes);
            using var img = Image.FromStream(ms);
            using var bmp = new Bitmap(img);
            int w = bmp.Width, h = bmp.Height;
            double scale = Math.Min(1.0, maxPx / (double)Math.Max(w, h));
            int nw = Math.Max(1, (int)Math.Round(w * scale));
            int nh = Math.Max(1, (int)Math.Round(h * scale));
            using var dst = new Bitmap(nw, nh);
            using (var g = Graphics.FromImage(dst))
            {
                g.Clear(Color.White);
                g.DrawImage(bmp, 0, 0, nw, nh);
            }
            dst.Save(outPng, ImageFormat.Png);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
