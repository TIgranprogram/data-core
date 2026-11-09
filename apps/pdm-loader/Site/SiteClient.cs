using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using DataCore.PdmLoader.Model;

namespace DataCore.PdmLoader.Site;

/// <summary>Вход на стенд/сайт и вызовы pdm-import (только JWT пользователя).</summary>
public sealed class SiteClient : IDisposable
{
    readonly CookieContainer _cookies = new();
    readonly HttpClientHandler _handler;
    readonly HttpClient _http;
    string? _access;
    string? _refresh;
    public string BaseUrl { get; }

    static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public SiteClient(string baseUrl)
    {
        BaseUrl = baseUrl.Trim().TrimEnd('/');
        _handler = new HttpClientHandler { CookieContainer = _cookies, UseCookies = true };
        _http = new HttpClient(_handler) { BaseAddress = new Uri(BaseUrl), Timeout = TimeSpan.FromMinutes(10) };
    }

    public bool IsLoggedIn => !string.IsNullOrEmpty(_access);

    public async Task LoginAsync(string username, string password, CancellationToken ct = default)
    {
        var body = JsonSerializer.Serialize(new { username, password });
        using var resp = await _http.PostAsync("/api/auth/login", JsonContent(body), ct);
        var text = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new SiteException((int)resp.StatusCode, MessageOf(text, "Ошибка входа"));
        using var doc = JsonDocument.Parse(text);
        _access = Str(doc.RootElement, "access") ?? Str(doc.RootElement, "accessToken");
        _refresh = Str(doc.RootElement, "refresh");
        if (string.IsNullOrEmpty(_access))
            throw new SiteException(200, "Сервер не вернул токен доступа");
    }

    public async Task EnsureAccessAsync(CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_access)) throw new SiteException(401, "Сначала войдите на сайт");
        // лёгкая проверка — если 401 на следующем запросе, обновим
        await Task.CompletedTask;
    }

    public async Task RefreshAsync(CancellationToken ct = default)
    {
        if (string.IsNullOrEmpty(_refresh))
            throw new SiteException(401, "Нет токена обновления — войдите снова");
        using var req = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _refresh);
        req.Content = JsonContent("{}");
        using var resp = await _http.SendAsync(req, ct);
        var text = await resp.Content.ReadAsStringAsync(ct);
        if (!resp.IsSuccessStatusCode)
            throw new SiteException((int)resp.StatusCode, MessageOf(text, "Не удалось обновить вход"));
        using var doc = JsonDocument.Parse(text);
        _access = Str(doc.RootElement, "access") ?? Str(doc.RootElement, "accessToken") ?? _access;
        _refresh = Str(doc.RootElement, "refresh") ?? _refresh;
    }

    public async Task<JsonDocument> PreviewAsync(PdmTree tree, CancellationToken ct = default)
    {
        var json = TreeBuilderJson(tree);
        return await SendJsonAsync(HttpMethod.Post, "/api/pdm-import/preview", json, ct);
    }

    public async Task<JsonDocument> ApplyAsync(string planId, Dictionary<string, DecisionDto> decisions, PdmTree? tree = null, CancellationToken ct = default)
    {
        object payload = tree == null
            ? new { planId, decisions }
            : new { planId, decisions, tree = JsonSerializer.Deserialize<JsonElement>(TreeBuilderJson(tree)) };
        var json = JsonSerializer.Serialize(payload, JsonOpts);
        return await SendJsonAsync(HttpMethod.Post, "/api/pdm-import/apply", json, ct);
    }

    public async Task<JsonDocument> UploadFileAsync(
        string importId, string designation, string type, string name,
        int pdmFileId, int version, string? state, string? modified, string sha256,
        string localPath, CancellationToken ct = default)
    {
        await EnsureAccessAsync(ct);
        for (int attempt = 0; attempt < 3; attempt++)
        {
            using var form = new MultipartFormDataContent();
            form.Add(new StringContent(importId), "importId");
            form.Add(new StringContent(designation), "designation");
            form.Add(new StringContent(type), "type");
            form.Add(new StringContent(name), "name");
            form.Add(new StringContent(pdmFileId.ToString()), "pdmFileId");
            form.Add(new StringContent(version.ToString()), "version");
            if (!string.IsNullOrEmpty(state)) form.Add(new StringContent(state), "state");
            if (!string.IsNullOrEmpty(modified)) form.Add(new StringContent(modified), "modified");
            form.Add(new StringContent(sha256), "sha256");
            var bytes = await File.ReadAllBytesAsync(localPath, ct);
            var fileContent = new ByteArrayContent(bytes);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
            form.Add(fileContent, "file", Path.GetFileName(localPath));

            using var req = new HttpRequestMessage(HttpMethod.Post, "/api/pdm-import/files") { Content = form };
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _access);
            using var resp = await _http.SendAsync(req, ct);
            var text = await resp.Content.ReadAsStringAsync(ct);
            if (resp.StatusCode == HttpStatusCode.Unauthorized && attempt == 0)
            {
                await RefreshAsync(ct);
                continue;
            }
            if (!resp.IsSuccessStatusCode)
                throw new SiteException((int)resp.StatusCode, MessageOf(text, "Ошибка загрузки файла"));
            return JsonDocument.Parse(text);
        }
        throw new SiteException(401, "Не удалось загрузить файл после обновления входа");
    }

    public async Task<JsonDocument> GetAsync(string path, CancellationToken ct = default)
        => await SendJsonAsync(HttpMethod.Get, path, null, ct);

    public async Task<string> GetRawAsync(string path, CancellationToken ct = default)
    {
        using var req = await AuthRequestAsync(HttpMethod.Get, path, null, ct);
        using var resp = await _http.SendAsync(req, ct);
        var text = await resp.Content.ReadAsStringAsync(ct);
        if (resp.StatusCode == HttpStatusCode.Unauthorized)
        {
            await RefreshAsync(ct);
            using var req2 = await AuthRequestAsync(HttpMethod.Get, path, null, ct);
            using var resp2 = await _http.SendAsync(req2, ct);
            text = await resp2.Content.ReadAsStringAsync(ct);
            if (!resp2.IsSuccessStatusCode)
                throw new SiteException((int)resp2.StatusCode, MessageOf(text, "Ошибка запроса"));
            return text;
        }
        if (!resp.IsSuccessStatusCode)
            throw new SiteException((int)resp.StatusCode, MessageOf(text, "Ошибка запроса"));
        return text;
    }

    async Task<JsonDocument> SendJsonAsync(HttpMethod method, string path, string? json, CancellationToken ct)
    {
        using var req = await AuthRequestAsync(method, path, json, ct);
        using var resp = await _http.SendAsync(req, ct);
        var text = await resp.Content.ReadAsStringAsync(ct);
        if (resp.StatusCode == HttpStatusCode.Unauthorized)
        {
            await RefreshAsync(ct);
            using var req2 = await AuthRequestAsync(method, path, json, ct);
            using var resp2 = await _http.SendAsync(req2, ct);
            text = await resp2.Content.ReadAsStringAsync(ct);
            if (!resp2.IsSuccessStatusCode)
                throw new SiteException((int)resp2.StatusCode, MessageOf(text, "Ошибка запроса"));
            return JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
        }
        if (!resp.IsSuccessStatusCode)
            throw new SiteException((int)resp.StatusCode, MessageOf(text, "Ошибка запроса"));
        return JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text);
    }

    async Task<HttpRequestMessage> AuthRequestAsync(HttpMethod method, string path, string? json, CancellationToken ct)
    {
        await EnsureAccessAsync(ct);
        var req = new HttpRequestMessage(method, path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _access);
        if (json != null) req.Content = JsonContent(json);
        return req;
    }

    static StringContent JsonContent(string json) =>
        new(json, Encoding.UTF8, "application/json");

    static string TreeBuilderJson(PdmTree tree) =>
        Pdm.TreeBuilder.ToJson(tree);

    static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;

    static string MessageOf(string json, string fallback)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("message", out var m))
            {
                if (m.ValueKind == JsonValueKind.String) return m.GetString() ?? fallback;
                if (m.ValueKind == JsonValueKind.Array)
                    return string.Join("; ", m.EnumerateArray().Select(x => x.ToString()));
            }
        }
        catch { /* */ }
        return string.IsNullOrWhiteSpace(json) ? fallback : json.Length > 400 ? json[..400] + "…" : json;
    }

    public void Dispose()
    {
        _http.Dispose();
        _handler.Dispose();
    }
}

public sealed class DecisionDto
{
    public string action { get; set; } = "create";
    public string? targetId { get; set; }
    public Dictionary<string, string>? fields { get; set; }
}

public sealed class SiteException : Exception
{
    public int StatusCode { get; }
    public SiteException(int status, string message) : base(message) => StatusCode = status;
}
