using WaterNetwork.Design.Contracts.Events;
using WaterNetwork.Design.Domain.ValueObjects;
namespace WaterNetwork.Design.Application.Services;
public static class NetworkEditMapping
{
    public static NetworkEditOperationV1 ToContract(NetworkEditOperation x) => new(x.Id, x.Action, x.Kind, x.TargetId, x.ExpectedVersion, ToContract(x.After), ToContract(x.Before));
    public static NetworkEditOperation ToDomain(NetworkEditOperationV1 x) => new(x.Id, x.Action, x.Kind, x.TargetId, x.ExpectedVersion, ToDomain(x.After), ToDomain(x.Before));
    private static ReadyForGisAssetV1? ToContract(DraftAssetSnapshot? x) => x is null ? null : new(x.DraftAssetId,x.Kind,x.AssetCode,x.ClientRef,new(x.Geometry.Type,x.Geometry.Coordinates),x.Attributes,x.FromRef,x.ToRef,x.HostRef);
    private static DraftAssetSnapshot? ToDomain(ReadyForGisAssetV1? x) => x is null ? null : new(x.DraftAssetId,x.Kind,x.AssetCode,x.ClientRef,new(x.Geometry.Type,x.Geometry.Coordinates),x.Attributes,x.FromRef,x.ToRef,x.HostRef);
}
