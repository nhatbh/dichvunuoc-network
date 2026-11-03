namespace WaterNetwork.Design.Application.Ports;

public sealed record ImportResultRow(string DraftAssetId, string? GisAssetId, string Status, string? Reason);

public interface IDesignImportResultStore
{
    Task SaveResultsAsync(string tenantId, string revisionId, IReadOnlyList<ImportResultRow> rows, CancellationToken ct);
    Task<IReadOnlyList<ImportResultRow>> ListAsync(string tenantId, string revisionId, CancellationToken ct);
}
