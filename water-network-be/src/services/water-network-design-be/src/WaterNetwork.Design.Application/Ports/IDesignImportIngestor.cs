using System.Text.Json;
using WaterNetwork.Design.Application.Commands;

namespace WaterNetwork.Design.Application.Ports;

public sealed record DesignImportInput(
    string ImportKey, string Name, IReadOnlyList<DraftAssetInput> Assets, JsonElement Provenance);
public sealed record DesignImportReceipt(string ProjectId, string RevisionId, int AssetCount);

public interface IDesignImportIngestor
{
    Task<DesignImportReceipt> IngestAsync(DesignImportInput input, CancellationToken ct);
}
