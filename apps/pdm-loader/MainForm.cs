using System.Text;
using System.Text.Json;
using DataCore.PdmLoader.Model;
using DataCore.PdmLoader.Pdm;
using DataCore.PdmLoader.Site;

namespace DataCore.PdmLoader;

public sealed class MainForm : Form
{
    readonly TextBox _site = new() { Text = "https://kppdf-crm.ru/db", Width = 260 }; // 2026-11-10: было localhost
    readonly TextBox _user = new() { Width = 100 };
    readonly TextBox _pass = new() { Width = 100, UseSystemPasswordChar = true };
    readonly TextBox _number = new() { Text = "6104.0000.0000", Width = 160 };
    readonly Label _status = new() { AutoSize = true, Text = "Готово к работе", Padding = new Padding(8, 10, 0, 0) };
    readonly TreeView _tree = new() { Dock = DockStyle.Fill };
    readonly ListView _plan = new() { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, CheckBoxes = false };
    readonly ListView _warn = new() { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true };
    readonly Button _btnUpdateAll = new() { Text = "Обновить всё из PDM", AutoSize = true, Enabled = false };

    PdmTree? _current;
    SiteClient? _siteClient;
    string? _planId;
    Dictionary<string, JsonElement>? _planItems;
    readonly Dictionary<string, DecisionUi> _decisions = new(StringComparer.OrdinalIgnoreCase);
    VaultSession? _session;

    sealed class DecisionUi
    {
        public string Action { get; set; } = "create";
        public string? TargetId { get; set; }
        public Dictionary<string, string> Fields { get; } = new(StringComparer.OrdinalIgnoreCase);
    }

    public MainForm()
    {
        Text = "DataCore · Загрузка из PDM";
        Width = 1200;
        Height = 780;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10f);

        _plan.Columns.Add("Обозначение", 160);
        _plan.Columns.Add("На сайте", 140);
        _plan.Columns.Add("Решение", 420);
        _warn.Columns.Add("Обозначение", 160);
        _warn.Columns.Add("Сообщение", 700);

        var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 100, Padding = new Padding(8), WrapContents = true };
        top.Controls.Add(Lbl("Сайт:"));
        top.Controls.Add(_site);
        top.Controls.Add(Lbl("Вход:"));
        top.Controls.Add(_user);
        top.Controls.Add(_pass);
        var btnLogin = new Button { Text = "Войти", AutoSize = true };
        btnLogin.Click += async (_, _) => await LoginAsync();
        top.Controls.Add(btnLogin);
        top.Controls.Add(Lbl("Номер изделия:"));
        top.Controls.Add(_number);
        var btnFind = new Button { Text = "Найти в PDM", AutoSize = true };
        btnFind.Click += async (_, _) => await FindAsync();
        top.Controls.Add(btnFind);

        var buttons = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 52, Padding = new Padding(8) };
        var btnSave = new Button { Text = "Сохранить пакет на диск", AutoSize = true };
        btnSave.Click += (_, _) => SavePackage();
        var btnPreview = new Button { Text = "Проверить на сайте", AutoSize = true };
        btnPreview.Click += async (_, _) => await SitePreviewAsync();
        var btnApply = new Button { Text = "Загрузить на сайт", AutoSize = true };
        btnApply.Click += async (_, _) => await SiteApplyAsync();
        _btnUpdateAll.Click += (_, _) => UpdateAllFromPdm();
        buttons.Controls.Add(btnSave);
        buttons.Controls.Add(btnPreview);
        buttons.Controls.Add(btnApply);
        buttons.Controls.Add(_btnUpdateAll);
        buttons.Controls.Add(_status);

        var splitMain = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Vertical, SplitterDistance = 520 };
        splitMain.Panel1.Controls.Add(_tree);
        var right = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 420 };
        right.Panel1.Controls.Add(_plan);
        right.Panel2.Controls.Add(_warn);
        splitMain.Panel2.Controls.Add(right);

        _plan.DoubleClick += (_, _) => EditSelectedDecision();

        Controls.Add(splitMain);
        Controls.Add(buttons);
        Controls.Add(top);

        Load += (_, _) =>
        {
            try
            {
                var cfg = Path.Combine(AppPaths.Root, "settings.txt");
                if (!File.Exists(cfg)) return;
                var lines = File.ReadAllLines(cfg);
                if (lines.Length > 0) _site.Text = lines[0];
                if (lines.Length > 1) _user.Text = lines[1];
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
            _siteClient?.Dispose();
        };
    }

    static Label Lbl(string t) => new() { Text = t, AutoSize = true, Padding = new Padding(0, 8, 0, 0) };

    async Task LoginAsync()
    {
        _status.Text = "Вхожу на сайт…";
        try
        {
            _siteClient?.Dispose();
            _siteClient = new SiteClient(ApiBase());
            await _siteClient.LoginAsync(_user.Text.Trim(), _pass.Text);
            _status.Text = "Вход выполнен";
            try
            {
                using var ver = await _siteClient.GetAsync("api/apps/pdm-loader");
                var remote = ver.RootElement.TryGetProperty("version", out var rv) ? rv.GetString() : null;
                // 2026-11-10: было жёстко «1.1.0» — версия 1.1.2 просила скачать сама себя; своя версия — из сборки (csproj <Version>)
                var mine = typeof(MainForm).Assembly.GetName().Version is { } v ? $"{v.Major}.{v.Minor}.{v.Build}" : "0.0.0";
                if (remote != null && CompareVer(remote, mine) > 0)
                    MessageBox.Show($"На сайте версия {remote}. Скачайте новую версию приложения.", "Версия");
            }
            catch { /* приложение на сервере ещё не выложено */ }
        }
        catch (SiteException ex)
        {
            _status.Text = ex.StatusCode == 403 ? "Нужны права администратора" : "Ошибка входа: " + ex.Message;
            _siteClient = null;
        }
        catch (Exception ex)
        {
            _status.Text = "Сайт недоступен: " + ex.Message;
            _siteClient = null;
        }
    }

    static int CompareVer(string a, string b)
    {
        var pa = a.Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
        var pb = b.Split('.').Select(x => int.TryParse(x, out var n) ? n : 0).ToArray();
        for (int i = 0; i < 3; i++)
        {
            int ai = i < pa.Length ? pa[i] : 0, bi = i < pb.Length ? pb[i] : 0;
            if (ai != bi) return ai - bi;
        }
        return 0;
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
        _plan.Items.Clear();
        _warn.Items.Clear();
        _planId = null;
        _planItems = null;
        _decisions.Clear();
        _btnUpdateAll.Enabled = false;
        try
        {
            await Task.Run(() =>
            {
                _session?.Dispose();
                _session = VaultSession.LoginAuto(Handle);
                var builder = new TreeBuilder(_session, Handle, msg => BeginInvoke(() => _status.Text = msg));
                _current = builder.Build(num, withFiles: true, withBlanks: true);
            });
            PaintTree();
            _status.Text = _current == null ? "Нет данных" : $"Позиций: {_current.Items.Count}, связей: {_current.Bom.Count}";
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, Text);
            _status.Text = "Ошибка чтения PDM";
        }
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
            string mark = "";
            if (_planItems != null && _planItems.TryGetValue(des, out var row))
                mark = " · " + ActionRu(Str(row, "action"));
            var n = new TreeNode($"{des}  ·  {kind}  ·  ×{qty:0.###}  ·  {sort}  ·  заг.{blank}{mark}");
            if (_planItems != null && _planItems.TryGetValue(des, out var pr))
                n.ForeColor = ColorOf(Str(pr, "action"));
            if (byParent.TryGetValue(des, out var kids))
                foreach (var k in kids) n.Nodes.Add(NodeOf(k.Child, k.Qty));
            return n;
        }

        _tree.Nodes.Add(NodeOf(_current.Root, 1));
        _tree.ExpandAll();
        foreach (var w in _current.Warnings)
            _warn.Items.Add(new ListViewItem([w.Designation, w.Text]));
    }

    static string ActionRu(string? a) => a switch
    {
        "create" => "новое",
        "link" => "связать",
        "suggest" => "похоже",
        "conflict" => "расхождение",
        "same" => "без изменений",
        _ => a ?? "",
    };

    static Color ColorOf(string? a) => a switch
    {
        "create" => Color.DarkGreen,
        "suggest" => Color.DarkOrange,
        "conflict" => Color.Firebrick,
        "same" => Color.Gray,
        "link" => Color.DarkBlue,
        _ => Color.Black,
    };

    static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    async Task SitePreviewAsync()
    {
        if (_current == null) { MessageBox.Show("Сначала найдите изделие в PDM.", Text); return; }
        if (_siteClient == null || !_siteClient.IsLoggedIn) { MessageBox.Show("Сначала войдите на сайт.", Text); return; }
        _status.Text = "Проверяю на сайте…";
        try
        {
            // для preview файлы не нужны — облегчённое дерево уже в _current
            using var doc = await _siteClient.PreviewAsync(_current);
            var root = doc.RootElement;
            _planId = Str(root, "planId");
            _planItems = new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
            _decisions.Clear();
            if (root.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
            {
                foreach (var it in items.EnumerateArray())
                {
                    var des = Str(it, "designation");
                    if (des == null) continue;
                    _planItems[des] = it.Clone();
                    var action = Str(it, "action") ?? "create";
                    var d = new DecisionUi();
                    if (action is "create" or "link" or "same")
                    {
                        d.Action = action == "same" ? "keep-site" : action == "link" ? "link" : "create";
                        if (action == "link") d.TargetId = Str(it, "targetId");
                        if (action == "same") d.Action = "keep-site";
                    }
                    else if (action == "conflict")
                    {
                        d.Action = "update-all";
                        if (it.TryGetProperty("fields", out var fields) && fields.ValueKind == JsonValueKind.Array)
                            foreach (var f in fields.EnumerateArray())
                            {
                                var name = Str(f, "field");
                                if (name != null) d.Fields[name] = "pdm";
                            }
                    }
                    else if (action == "suggest")
                    {
                        d.Action = "create"; // пока не выбран кандидат
                    }
                    _decisions[des] = d;
                }
            }
            PaintPlan();
            PaintTree();
            _btnUpdateAll.Enabled = _decisions.Values.Any(x => x.Fields.Count > 0 || x.Action is "update-all" or "conflict");
            var summary = root.TryGetProperty("summary", out var s) ? s.ToString() : "";
            _status.Text = $"План {_planId}: {summary}";
            if (root.TryGetProperty("blockers", out var bl) && bl.GetArrayLength() > 0)
                MessageBox.Show("Есть препятствия:\n" + string.Join("\n", bl.EnumerateArray().Select(x => x.ToString())), Text);
        }
        catch (SiteException ex)
        {
            if (ex.StatusCode == 404) MessageBox.Show("Сайт ещё не принимает загрузку.", Text);
            else MessageBox.Show(ex.Message, Text);
            _status.Text = "Проверка не удалась";
        }
        catch (Exception ex)
        {
            MessageBox.Show("Сайт ещё не принимает загрузку.\n" + ex.Message, Text);
            _status.Text = "Проверка не удалась";
        }
    }

    void PaintPlan()
    {
        _plan.Items.Clear();
        if (_planItems == null) return;
        foreach (var (des, row) in _planItems.OrderBy(x => x.Key))
        {
            var action = Str(row, "action") ?? "";
            string detail = ActionRu(action);
            if (action == "conflict" && row.TryGetProperty("fields", out var fields))
            {
                var parts = fields.EnumerateArray().Select(f =>
                {
                    var name = Str(f, "field") ?? "?";
                    var site = f.TryGetProperty("site", out var s) ? s.ToString() : "";
                    var pdm = f.TryGetProperty("pdm", out var p) ? p.ToString() : "";
                    var choose = _decisions.TryGetValue(des, out var d) && d.Fields.TryGetValue(name, out var c) ? c : "pdm";
                    return $"{name}: сайт={site} | PDM={pdm} → {(choose == "site" ? "сайт" : "PDM")}";
                });
                detail = "расхождение: " + string.Join("; ", parts);
            }
            else if (action == "suggest" && row.TryGetProperty("candidates", out var cands))
            {
                var pick = _decisions.TryGetValue(des, out var d) ? d.TargetId : null;
                detail = pick == null
                    ? "похоже: " + string.Join(", ", cands.EnumerateArray().Select(c => Str(c, "article") + " «" + Str(c, "name") + "»"))
                    : "выбран " + pick;
            }
            else if (action == "link")
                detail = "уже есть → связать";
            else if (action == "same")
                detail = "без изменений";
            else if (action == "create")
                detail = "новое";

            var li = new ListViewItem([des, ActionRu(action), detail]) { Tag = des };
            li.ForeColor = ColorOf(action);
            _plan.Items.Add(li);
        }
    }

    void EditSelectedDecision()
    {
        if (_plan.SelectedItems.Count == 0 || _planItems == null) return;
        var des = _plan.SelectedItems[0].Tag as string;
        if (des == null || !_planItems.TryGetValue(des, out var row)) return;
        var action = Str(row, "action");
        if (!_decisions.TryGetValue(des, out var d)) d = _decisions[des] = new DecisionUi();

        if (action == "suggest" && row.TryGetProperty("candidates", out var cands))
        {
            var list = cands.EnumerateArray().Select(c => (Id: Str(c, "id")!, Label: $"{Str(c, "article")} — {Str(c, "name")}")).Where(x => x.Id != null).ToList();
            using var dlg = new Form
            {
                Text = "Похожие на сайте — " + des,
                Width = 480,
                Height = 320,
                StartPosition = FormStartPosition.CenterParent,
            };
            var lb = new ListBox { Dock = DockStyle.Fill };
            foreach (var c in list) lb.Items.Add(c.Label);
            var panel = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 40 };
            var okLink = new Button { Text = "Связать с выбранным", AutoSize = true };
            var okNew = new Button { Text = "Создать новое", AutoSize = true };
            okLink.Click += (_, _) =>
            {
                if (lb.SelectedIndex < 0) { MessageBox.Show("Выберите запись."); return; }
                d.Action = "link";
                d.TargetId = list[lb.SelectedIndex].Id;
                dlg.DialogResult = DialogResult.OK;
            };
            okNew.Click += (_, _) => { d.Action = "create"; d.TargetId = null; dlg.DialogResult = DialogResult.OK; };
            panel.Controls.Add(okLink);
            panel.Controls.Add(okNew);
            dlg.Controls.Add(lb);
            dlg.Controls.Add(panel);
            if (dlg.ShowDialog(this) == DialogResult.OK) PaintPlan();
            return;
        }

        if (action == "conflict" && row.TryGetProperty("fields", out var fields))
        {
            using var dlg = new Form
            {
                Text = "Расхождения — " + des,
                Width = 560,
                Height = 360,
                StartPosition = FormStartPosition.CenterParent,
            };
            var grid = new DataGridView
            {
                Dock = DockStyle.Fill,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
                AllowUserToAddRows = false,
                RowHeadersVisible = false,
            };
            grid.Columns.Add("field", "Поле");
            grid.Columns.Add("site", "Сайт");
            grid.Columns.Add("pdm", "PDM");
            var col = new DataGridViewComboBoxColumn { Name = "choose", HeaderText = "Взять", Items = { "PDM", "сайт" } };
            grid.Columns.Add(col);
            foreach (var f in fields.EnumerateArray())
            {
                var name = Str(f, "field") ?? "?";
                var site = f.TryGetProperty("site", out var s) ? s.ToString() : "";
                var pdm = f.TryGetProperty("pdm", out var p) ? p.ToString() : "";
                var cur = d.Fields.TryGetValue(name, out var c) && c == "site" ? "сайт" : "PDM";
                grid.Rows.Add(name, site, pdm, cur);
            }
            var panel = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 40 };
            var allPdm = new Button { Text = "Всё из PDM", AutoSize = true };
            var ok = new Button { Text = "Сохранить", AutoSize = true };
            var keep = new Button { Text = "Оставить сайт", AutoSize = true };
            allPdm.Click += (_, _) => { foreach (DataGridViewRow r in grid.Rows) r.Cells["choose"].Value = "PDM"; };
            keep.Click += (_, _) =>
            {
                d.Action = "keep-site";
                d.Fields.Clear();
                dlg.DialogResult = DialogResult.OK;
            };
            ok.Click += (_, _) =>
            {
                d.Action = "update-all";
                d.Fields.Clear();
                foreach (DataGridViewRow r in grid.Rows)
                {
                    var name = r.Cells["field"].Value?.ToString() ?? "";
                    var choose = r.Cells["choose"].Value?.ToString() == "сайт" ? "site" : "pdm";
                    if (!string.IsNullOrEmpty(name)) d.Fields[name] = choose;
                }
                dlg.DialogResult = DialogResult.OK;
            };
            panel.Controls.Add(allPdm);
            panel.Controls.Add(ok);
            panel.Controls.Add(keep);
            dlg.Controls.Add(grid);
            dlg.Controls.Add(panel);
            if (dlg.ShowDialog(this) == DialogResult.OK) { PaintPlan(); _btnUpdateAll.Enabled = true; }
        }
    }

    void UpdateAllFromPdm()
    {
        if (_planItems == null) return;
        foreach (var (des, row) in _planItems)
        {
            if (Str(row, "action") != "conflict") continue;
            if (!_decisions.TryGetValue(des, out var d)) d = _decisions[des] = new DecisionUi();
            d.Action = "update-all";
            d.Fields.Clear();
            if (row.TryGetProperty("fields", out var fields))
                foreach (var f in fields.EnumerateArray())
                {
                    var name = Str(f, "field");
                    if (name != null) d.Fields[name] = "pdm";
                }
        }
        PaintPlan();
        _status.Text = "Для всех расхождений выбрано «из PDM»";
    }

    async Task SiteApplyAsync()
    {
        if (_current == null) { MessageBox.Show("Сначала найдите изделие.", Text); return; }
        if (_siteClient == null || !_siteClient.IsLoggedIn) { MessageBox.Show("Сначала войдите на сайт.", Text); return; }
        if (string.IsNullOrEmpty(_planId)) { MessageBox.Show("Сначала нажмите «Проверить на сайте».", Text); return; }

        // незакрытые suggest
        foreach (var (des, row) in _planItems ?? [])
        {
            if (Str(row, "action") != "suggest") continue;
            if (!_decisions.TryGetValue(des, out var d) || (d.Action == "create" && d.TargetId == null && Str(row, "action") == "suggest" && !d.Fields.Any()))
            {
                // если action suggest и пользователь не выбрал — требуем
                if (!_decisions.TryGetValue(des, out var dd) || (dd.Action != "link" && dd.Action != "create"))
                {
                    MessageBox.Show($"Для «{des}» выберите похожую запись или «Создать новое» (двойной щелчок).", Text);
                    return;
                }
            }
        }

        var decisions = new Dictionary<string, DecisionDto>(StringComparer.OrdinalIgnoreCase);
        foreach (var (des, d) in _decisions)
        {
            decisions[des] = new DecisionDto
            {
                action = d.Action,
                targetId = d.TargetId,
                fields = d.Fields.Count > 0 ? new Dictionary<string, string>(d.Fields, StringComparer.OrdinalIgnoreCase) : null,
            };
        }

        _status.Text = "Загружаю на сайт…";
        try
        {
            using var doc = await _siteClient.ApplyAsync(_planId!, decisions, _current);
            var root = doc.RootElement;
            var importId = Str(root, "importId") ?? _planId!;
            int created = root.TryGetProperty("created", out var c) ? c.GetInt32() : 0;
            int linked = root.TryGetProperty("linked", out var l) ? l.GetInt32() : 0;
            int updated = root.TryGetProperty("updated", out var u) ? u.GetInt32() : 0;
            int skipped = root.TryGetProperty("skipped", out var sk) ? sk.GetInt32() : 0;
            var need = new List<string>();
            if (root.TryGetProperty("needFiles", out var nf) && nf.ValueKind == JsonValueKind.Array)
                need.AddRange(nf.EnumerateArray().Select(x => x.GetString()!).Where(x => x != null)!);

            int uploaded = 0, failed = 0;
            if (need.Count > 0)
            {
                _status.Text = $"Загружаю файлы 0/{need.Count}…";
                var bySha = _current.Items.SelectMany(i => i.Docs.Select(d => (Item: i, Doc: d)))
                    .Where(x => !string.IsNullOrEmpty(x.Doc.Sha256))
                    .GroupBy(x => x.Doc.Sha256, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
                int i = 0;
                foreach (var sha in need)
                {
                    i++;
                    _status.Text = $"Загружаю файлы {i}/{need.Count}…";
                    if (!bySha.TryGetValue(sha, out var pair)) { failed++; continue; }
                    var local = Directory.EnumerateFiles(AppPaths.Cache, pair.Doc.Name, SearchOption.AllDirectories).FirstOrDefault();
                    if (local == null) { failed++; continue; }
                    try
                    {
                        using var _ = await _siteClient.UploadFileAsync(
                            importId, pair.Item.Designation, pair.Doc.Type, pair.Doc.Name,
                            pair.Doc.PdmFileId, pair.Doc.Version, pair.Doc.State, pair.Doc.Modified, pair.Doc.Sha256, local);
                        uploaded++;
                    }
                    catch { failed++; }
                }
            }

            int pics = 0, picFail = 0, picSkip = 0;
            var withPreview = _current.Items.Where(x => !string.IsNullOrEmpty(x.Preview)).ToList();
            if (withPreview.Count > 0)
            {
                _status.Text = $"Загружаю картинки 0/{withPreview.Count}…";
                int i = 0;
                foreach (var it in withPreview)
                {
                    i++;
                    _status.Text = $"Загружаю картинки {i}/{withPreview.Count}…";
                    var name = Path.GetFileName(it.Preview!);
                    var local = Directory.EnumerateFiles(AppPaths.CacheFor("previews"), name, SearchOption.AllDirectories).FirstOrDefault()
                        ?? Directory.EnumerateFiles(AppPaths.Cache, name, SearchOption.AllDirectories).FirstOrDefault();
                    if (local == null) { picFail++; continue; }
                    try
                    {
                        await using var fs = File.OpenRead(local);
                        var sha = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(fs)).ToLowerInvariant();
                        using var _ = await _siteClient.UploadPreviewImageAsync(importId, it.Designation, sha, local);
                        pics++;
                    }
                    catch (SiteException ex) when (ex.StatusCode == 404)
                    {
                        picSkip = withPreview.Count - pics;
                        break; // сервер ещё без preview-image
                    }
                    catch { picFail++; }
                }
            }

            MessageBox.Show(
                $"Создано: {created}\nСвязано: {linked}\nОбновлено: {updated}\nБез изменений: {skipped}\nФайлов: {uploaded}" +
                (failed > 0 ? $"\nФайлов с ошибкой: {failed}" : "") +
                $"\nКартинок: {pics}" +
                (picSkip > 0 ? $"\nКартинки: сайт ещё не принимает ({picSkip} пропущено)" : "") +
                (picFail > 0 ? $"\nКартинок с ошибкой: {picFail}" : ""),
                "Загрузка на сайт");
            _status.Text = $"Готово: +{created} / связь {linked} / файлы {uploaded} / картинки {pics}";
        }
        catch (SiteException ex)
        {
            if (ex.StatusCode == 409)
                MessageBox.Show("Данные на сайте изменились — проверьте ещё раз.", Text);
            else if (ex.StatusCode == 404)
                MessageBox.Show("Сайт ещё не принимает загрузку.", Text);
            else
                MessageBox.Show(ex.Message, Text);
            _status.Text = "Загрузка не удалась";
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, Text);
            _status.Text = "Загрузка не удалась";
        }
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
                if (!string.IsNullOrEmpty(it.Preview))
                {
                    var name = Path.GetFileName(it.Preview);
                    var cache = Directory.EnumerateFiles(AppPaths.CacheFor("previews"), name, SearchOption.AllDirectories).FirstOrDefault()
                        ?? Directory.EnumerateFiles(AppPaths.Cache, name, SearchOption.AllDirectories).FirstOrDefault();
                    if (cache != null)
                    {
                        var dest = Path.Combine(tmp, "previews", name);
                        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                        File.Copy(cache, dest, true);
                    }
                }
            }
            if (File.Exists(dlg.FileName)) File.Delete(dlg.FileName);
            System.IO.Compression.ZipFile.CreateFromDirectory(tmp, dlg.FileName);
            try { Directory.Delete(tmp, true); } catch { }
        }
        _status.Text = "Пакет сохранён";
    }

    string ApiBase()
    {
        var s = SiteClient.NormalizeSite(_site.Text);
        return s;
    }
}
