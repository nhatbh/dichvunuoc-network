namespace WaterNetwork.Bff.Api.Http;

public interface IAssetApiClient
{
    Task<DownstreamResult<AssetProfile>> GetProfileAsync(string id, CancellationToken ct);
}
