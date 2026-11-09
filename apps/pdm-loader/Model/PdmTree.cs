using System.Text.Json.Serialization;

namespace DataCore.PdmLoader.Model;

public sealed class PdmTree
{
    [JsonPropertyName("schema")] public string Schema { get; set; } = "pdm-tree/1";
    [JsonPropertyName("vault")] public string Vault { get; set; } = "";
    [JsonPropertyName("readAt")] public string ReadAt { get; set; } = "";
    [JsonPropertyName("reader")] public ReaderInfo Reader { get; set; } = new();
    [JsonPropertyName("root")] public string Root { get; set; } = "";
    [JsonPropertyName("items")] public List<PdmItem> Items { get; set; } = [];
    [JsonPropertyName("bom")] public List<BomLink> Bom { get; set; } = [];
    [JsonPropertyName("warnings")] public List<PdmWarning> Warnings { get; set; } = [];
}

public sealed class ReaderInfo
{
    [JsonPropertyName("app")] public string App { get; set; } = "DataCore PDM Loader";
    [JsonPropertyName("version")] public string Version { get; set; } = "1.1.0";
    [JsonPropertyName("computer")] public string Computer { get; set; } = Environment.MachineName;
    [JsonPropertyName("user")] public string User { get; set; } = Environment.UserName;
}

public sealed class PdmItem
{
    [JsonPropertyName("designation")] public string Designation { get; set; } = "";
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("pdmKind")] public string? PdmKind { get; set; }
    [JsonPropertyName("aliases")] public List<string> Aliases { get; set; } = [];
    [JsonPropertyName("config")] public string? Config { get; set; }
    [JsonPropertyName("file")] public FileInfoDto? File { get; set; }
    [JsonPropertyName("vars")] public Dictionary<string, string?> Vars { get; set; } = new();
    [JsonPropertyName("size")] public SizeDto? Size { get; set; }
    [JsonPropertyName("blank")] public BlankDto? Blank { get; set; }
    [JsonPropertyName("massKg")] public double? MassKg { get; set; }
    [JsonPropertyName("ral")] public List<string>? Ral { get; set; }
    [JsonPropertyName("folder")] public string? Folder { get; set; }
    [JsonPropertyName("preview")] public string? Preview { get; set; }
    [JsonPropertyName("docs")] public List<DocDto> Docs { get; set; } = [];
}

public sealed class FileInfoDto
{
    [JsonPropertyName("id")] public int Id { get; set; }
    [JsonPropertyName("path")] public string Path { get; set; } = "";
    [JsonPropertyName("version")] public int Version { get; set; }
    [JsonPropertyName("state")] public string? State { get; set; }
    [JsonPropertyName("modified")] public string? Modified { get; set; }
}

public sealed class SizeDto
{
    [JsonPropertyName("length")] public double? Length { get; set; }
    [JsonPropertyName("width")] public double? Width { get; set; }
    [JsonPropertyName("thickness")] public double? Thickness { get; set; }
}

public sealed class BlankDto
{
    [JsonPropertyName("length")] public double? Length { get; set; }
    [JsonPropertyName("width")] public double? Width { get; set; }
    [JsonPropertyName("thickness")] public double? Thickness { get; set; }
    [JsonPropertyName("source")] public string? Source { get; set; }
}

public sealed class DocDto
{
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("pdmFileId")] public int PdmFileId { get; set; }
    [JsonPropertyName("version")] public int Version { get; set; }
    [JsonPropertyName("state")] public string? State { get; set; }
    [JsonPropertyName("modified")] public string? Modified { get; set; }
    [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";
    [JsonPropertyName("size")] public long Size { get; set; }
    [JsonPropertyName("file")] public string File { get; set; } = "";
}

public sealed class BomLink
{
    [JsonPropertyName("parent")] public string Parent { get; set; } = "";
    [JsonPropertyName("child")] public string Child { get; set; } = "";
    [JsonPropertyName("qty")] public double Qty { get; set; }
}

public sealed class PdmWarning
{
    [JsonPropertyName("designation")] public string Designation { get; set; } = "";
    [JsonPropertyName("code")] public string Code { get; set; } = "";
    [JsonPropertyName("text")] public string Text { get; set; } = "";
}
