using System.Text;
using System.Text.Json;
using DataCore.PdmLoader.Model;
using DataCore.PdmLoader.Pdm;

namespace DataCore.PdmLoader;

public sealed class MainForm : Form
{
    readonly TextBox _site = new() { Text = "https://kppdf-crm.ru/db", Width = 280 };
    readonly TextBox _user = new() { Width = 120 };
    readonly TextBox _pass = new() { Width = 120, UseSystemPasswordChar = true };
    readonly TextBox _number = new() { Text = "6104.0000.0000", Width = 180 };
    readonly Label _status = new() { AutoSize = true, Text = "Готово к работе" };
    readonly TreeView _tree = new() { Dock = DockStyle.Fill };
    readonly ListView _warn = new() { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true };
    PdmTree? _current;
    string? _token;
    VaultSession? _session;

    public MainForm()
    {
        Text = "DataCore · Загрузка из PDM";
        Width = 1100;
        Height = 720;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10f);

        _warn.Columns.Add("Обозначение", 160);
        _warn.Columns.Add("Сообщение", 600);

        var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 100, Padding = new Padding(8), WrapContents = true };
        top.Controls.Add(new Label { Text = "Сайт:", AutoSize = true, Padding = new Padding(0, 8, 0, 0) });
        top.Controls.Add(_site);
        top.Controls.Add(new Label { Text = "Вход:", AutoSize = true, Padding = new Padding(8, 8, 0, 0) });
        top.Controls.Add(_user);
        top.Controls.Add(_pass);
        var btnLogin = new Button { Text = "Войти", AutoSize = true };
        btnLogin.Click += async (_, _) => await LoginAsync();
        top.Controls.Add(btnLogin);

        top.Controls.Add(new Label { Text = "Номер изделия:", AutoSize = true, Padding = new Padding(0, 8, 0, 0) });
        top.Controls.Add(_number);
        var btnFind = new Button { Text = "Найти в PDM", AutoSize = true };
        btnFind.Click += async (_, _) => await FindAsync();
        top.Controls.Add(btnFind);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 48, Padding = new Padding(8) };
        var btnSave = new Button { Text = "Сохранить пакет на диск", AutoSize = true };
        btnSave.Click += (_, _) => SavePackage();
        var btnPreview = new Button { Text = "Проверить на сайте", AutoSize = true };
        btnPreview.Click += async (_, _) => await SitePreviewAsync();
        var btnApply = new Button { Text = "Загрузить на сайт", AutoSize = true };
        btnApply.Click += async (_, _) => await SiteApplyAsync();
        buttons.Controls.Add(btnSave);
        buttons.Controls.Add(btnPreview);
        buttons.Controls.Add(btnApply);
        buttons.Controls.Add(_status);

        var split = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 480 };
        split.Panel1.Controls.Add(_tree);
        split.Panel2.Controls.Add(_warn);

        Controls.Add(split);
        Controls.Add(buttons);
        Controls.Add(top);

        Load += (_, _) =>
        {
            try
            {
                var cfg = Path.Combine(AppPaths.Root, "settings.txt");
                if (File.Exists(cfg))
                {
                    var lines = File.ReadAllLines(cfg);
                    if (lines.Length > 0) _site.Text = lines[0];
                    if (lines.Length > 1) _user.Text = lines[1];
                }
            }
            catch { /* */ }
        };
        FormClosing += (_, _) =>
        {
            try
            {
                Directory.CreateDirectory(AppPaths.Root);
                File.WriteAllLines(Path.Combine(AppPaths.Root, "settings.txt"), [_site.Text.Trim(), _user.Text.Trim()]);
            }
            catch { /* */ }
            _session?.Dispose();
        };
    }

    async Task LoginAsync()
    {
        _status.Text = "Вхожу на сайт…";
        try
        {
            using var http = new HttpClient { BaseAddress = new Uri(ApiBase()) };
            var body = JsonSerializer.Serialize(new { username = _user.Text.Trim(), password = _pass.Text });
            var resp = await http.PostAsync("/api/auth/login", new StringContent(body, Encoding.UTF8, "application/json"));
            var json = await resp.Content.ReadAsStringAsync();
            if (!resp.IsSuccessStatusCode)
            {
                _status.Text = "Ошибка входа: " + Trunc(json);
                _token = null;
                return;
            }
            using var doc = JsonDocument.Parse(json);
            _token = doc.RootElement.TryGetProperty("accessToken", out var t) ? t.GetString() : null;
            _status.Text = string.IsNullOrEmpty(_token) ? "Вход без токена" : "Вход выполнен";
            try
            {
                http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _token);
                var ver = await http.GetStringAsync("/api/apps/pdm-loader");
                using var vdoc = JsonDocument.Parse(ver);
                var remote = vdoc.RootElement.TryGetProperty("version", out var rv) ? rv.GetString() : null;
                if (remote != null && remote != "1.0.0")
                    MessageBox.Show($"На сайте версия {remote}. Скачайте новую версию приложения.", "Версия", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch { /* сервер Э1 ещё не готов */ }
        }
        catch (Exception ex)
        {
            _status.Text = "Сайт недоступен: " + ex.Message;
            _token = null;
        }
    }

    async Task FindAsync()
    {
        string num = _number.Text.Trim();
        if (string.IsNullOrWhiteSpace(num))
        {
            MessageBox.Show("Укажите номер изделия.", Text);
            return;
        }
        _status.Text = "Читаю PDM…";
        _tree.Nodes.Clear();
        _warn.Items.Clear();
        await Task.Run(() =>
        {
            _session?.Dispose();
            _session = VaultSession.LoginAuto(Handle);
            var builder = new TreeBuilder(_session, Handle, msg => BeginInvoke(() => _status.Text = msg));
            _current = builder.Build(num, withFiles: true);
        });
        PaintTree();
        _status.Text = _current == null ? "Нет данных" : $"Позиций: {_current.Items.Count}, связей: {_current.Bom.Count}";
    }

    void PaintTree()
    {
        _tree.Nodes.Clear();
        _warn.Items.Clear();
        if (_current == null) return;
        var byParent = _current.Bom.GroupBy(b => b.Parent).ToDictionary(g => g.Key, g => g.ToList());
        var items = _current.Items.ToDictionary(i => i.Designation, StringComparer.OrdinalIgnoreCase);

        TreeNode NodeOf(string des, double qty)
        {
            items.TryGetValue(des, out var it);
            string kind = it?.PdmKind ?? it?.Kind ?? "";
            string sort = it?.Vars.GetValueOrDefault("Сортамент") ?? "";
            string blank = it?.Blank == null ? "" : $"{it.Blank.Length}×{it.Blank.Width}";
            string files = it == null ? "" : string.Join(",", it.Docs.Select(d => d.Type));
            var n = new TreeNode($"{des}  ·  {kind}  ·  ×{qty:0.###}  ·  {sort}  ·  заг.{blank}  ·  {files}");
            if (byParent.TryGetValue(des, out var kids))
            {
                foreach (var k in kids)
                    n.Nodes.Add(NodeOf(k.Child, k.Qty));
            }
            return n;
        }

        _tree.Nodes.Add(NodeOf(_current.Root, 1));
        _tree.ExpandAll();
        foreach (var w in _current.Warnings)
            _warn.Items.Add(new ListViewItem([w.Designation, w.Text]));
    }

    void SavePackage()
    {
        if (_current == null)
        {
            MessageBox.Show("Сначала найдите изделие в PDM.", Text);
            return;
        }
        using var dlg = new SaveFileDialog
        {
            Filter = "Пакет (*.zip)|*.zip|Дерево (*.json)|*.json",
            FileName = _current.Root + ".pdm-pack.zip",
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        if (dlg.FileName.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            File.WriteAllText(dlg.FileName, TreeBuilder.ToJson(_current), Encoding.UTF8);
        }
        else
        {
            var tmp = Path.Combine(AppPaths.Temp, "pack-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tmp);
            File.WriteAllText(Path.Combine(tmp, "tree.json"), TreeBuilder.ToJson(_current), Encoding.UTF8);
            Directory.CreateDirectory(Path.Combine(tmp, "files"));
            Directory.CreateDirectory(Path.Combine(tmp, "previews"));
            // файлы уже в кэше — копируем по ссылкам docs
            foreach (var it in _current.Items)
            {
                foreach (var d in it.Docs)
                {
                    var cache = Directory.EnumerateFiles(AppPaths.Cache, d.Name, SearchOption.AllDirectories).FirstOrDefault();
                    if (cache == null) continue;
                    var dest = Path.Combine(tmp, d.File.Replace('/', Path.DirectorySeparatorChar));
                    Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                    File.Copy(cache, dest, true);
                }
            }
            if (File.Exists(dlg.FileName)) File.Delete(dlg.FileName);
            System.IO.Compression.ZipFile.CreateFromDirectory(tmp, dlg.FileName);
            try { Directory.Delete(tmp, true); } catch { }
        }
        _status.Text = "Пакет сохранён";
    }

    async Task SitePreviewAsync()
    {
        if (_current == null) { MessageBox.Show("Сначала найдите изделие.", Text); return; }
        if (string.IsNullOrEmpty(_token)) { MessageBox.Show("Сначала войдите на сайт.", Text); return; }
        try
        {
            using var http = new HttpClient { BaseAddress = new Uri(ApiBase()) };
            http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _token);
            var resp = await http.PostAsync("/api/pdm-import/preview",
                new StringContent(TreeBuilder.ToJson(_current), Encoding.UTF8, "application/json"));
            var text = await resp.Content.ReadAsStringAsync();
            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
                MessageBox.Show("Сайт ещё не принимает загрузку.", Text);
            else
                MessageBox.Show(Trunc(text, 2000), "Проверка на сайте");
        }
        catch (Exception ex)
        {
            MessageBox.Show("Сайт ещё не принимает загрузку.\n" + ex.Message, Text);
        }
    }

    async Task SiteApplyAsync()
    {
        if (_current == null) { MessageBox.Show("Сначала найдите изделие.", Text); return; }
        if (string.IsNullOrEmpty(_token)) { MessageBox.Show("Сначала войдите на сайт.", Text); return; }
        try
        {
            using var http = new HttpClient { BaseAddress = new Uri(ApiBase()) };
            http.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _token);
            var body = JsonSerializer.Serialize(new { tree = _current, decisions = new { } });
            var resp = await http.PostAsync("/api/pdm-import/apply",
                new StringContent(body, Encoding.UTF8, "application/json"));
            var text = await resp.Content.ReadAsStringAsync();
            if (resp.StatusCode == System.Net.HttpStatusCode.NotFound)
                MessageBox.Show("Сайт ещё не принимает загрузку.", Text);
            else
                MessageBox.Show(Trunc(text, 2000), "Загрузка на сайт");
        }
        catch (Exception ex)
        {
            MessageBox.Show("Сайт ещё не принимает загрузку.\n" + ex.Message, Text);
        }
    }

    string ApiBase()
    {
        var s = _site.Text.Trim().TrimEnd('/');
        if (s.EndsWith("/db", StringComparison.OrdinalIgnoreCase)) return s;
        return s;
    }

    static string Trunc(string s, int n = 300) => s.Length <= n ? s : s[..n] + "…";
}
