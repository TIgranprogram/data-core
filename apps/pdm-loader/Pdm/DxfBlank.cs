using System.Globalization;
using netDxf;
using netDxf.Entities;

namespace DataCore.PdmLoader.Pdm;

/// <summary>Габарит развёртки по геометрии DXF (не по $EXTMIN/$EXTMAX).</summary>
public static class DxfBlank
{
    static readonly HashSet<string> SkipLayers = new(StringComparer.OrdinalIgnoreCase)
    {
        "Bend", "BEND", "Гиб", "Гибы", "TEXT", "Annotations", "Dim", "Dimensions", "Надписи", "Текст",
    };

    public static (double Length, double Width)? Measure(string dxfPath)
    {
        DxfDocument doc;
        try { doc = DxfDocument.Load(dxfPath); }
        catch { return null; }

        double minX = double.PositiveInfinity, minY = double.PositiveInfinity;
        double maxX = double.NegativeInfinity, maxY = double.NegativeInfinity;
        bool any = false;

        void Add(double x, double y)
        {
            any = true;
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
        }

        void AddEntity(EntityObject e)
        {
            if (e.Layer != null && SkipLayers.Contains(e.Layer.Name)) return;
            switch (e)
            {
                case Line ln:
                    Add(ln.StartPoint.X, ln.StartPoint.Y);
                    Add(ln.EndPoint.X, ln.EndPoint.Y);
                    break;
                case Circle c:
                    Add(c.Center.X - c.Radius, c.Center.Y - c.Radius);
                    Add(c.Center.X + c.Radius, c.Center.Y + c.Radius);
                    break;
                case Arc a:
                    // грубо — по bbox дуги через точки
                    for (int i = 0; i <= 16; i++)
                    {
                        double t = a.StartAngle + (a.EndAngle - a.StartAngle) * i / 16.0;
                        double rad = t * Math.PI / 180.0;
                        Add(a.Center.X + a.Radius * Math.Cos(rad), a.Center.Y + a.Radius * Math.Sin(rad));
                    }
                    break;
                case Polyline2D p2:
                    foreach (var v in p2.Vertexes) Add(v.Position.X, v.Position.Y);
                    break;
                case Insert:
                    break;
                case Spline sp:
                    foreach (var v in sp.ControlPoints) Add(v.X, v.Y);
                    break;
            }
        }

        foreach (var e in doc.Entities.All) AddEntity(e);

        if (!any) return null;
        double dx = Math.Abs(maxX - minX);
        double dy = Math.Abs(maxY - minY);
        // длина = большая сторона
        double L = Math.Max(dx, dy);
        double W = Math.Min(dx, dy);
        // округление до 0.1 мм
        L = Math.Round(L, 1);
        W = Math.Round(W, 1);
        return (L, W);
    }

    public static bool IsSheetAssortment(string? assortment)
    {
        if (string.IsNullOrWhiteSpace(assortment)) return false;
        var a = assortment.Trim();
        return a.StartsWith("Лист", StringComparison.OrdinalIgnoreCase)
            || a.StartsWith("Лист нерж", StringComparison.OrdinalIgnoreCase)
            || a.Contains("Лист,", StringComparison.OrdinalIgnoreCase);
    }

    public static double? ThicknessFromAssortment(string? assortment)
    {
        if (string.IsNullOrWhiteSpace(assortment)) return null;
        // «Лист, 4 мм, …»
        var m = System.Text.RegularExpressions.Regex.Match(assortment, @"(\d+[.,]?\d*)\s*мм");
        if (!m.Success) return null;
        return double.TryParse(m.Groups[1].Value.Replace(',', '.'), NumberStyles.Float, CultureInfo.InvariantCulture, out var t) ? t : null;
    }
}
