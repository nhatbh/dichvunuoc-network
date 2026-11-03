using System.Text.Json;

namespace WaterNetwork.Design.Contracts.Requests;

public sealed record CreateDesignImportRequest(
    string ImportKey, string Name, IReadOnlyList<CreateDraftAssetRequest> Assets, JsonElement Provenance);
