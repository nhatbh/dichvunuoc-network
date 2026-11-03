// DraftAssetMapper.cs
using WaterNetwork.Design.Application.Geometry;
using WaterNetwork.Design.Domain.Entities;
using WaterNetwork.Design.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;

namespace WaterNetwork.Design.Application.Commands;

internal static class DraftAssetMapper
{
    public static DraftNetworkAsset ToDraft(string revisionId, string tenantId, DraftAssetInput input)
    {
        var kind = input.Kind switch
        {
            "Node" => DraftAssetKind.Node,
            "Pipe" => DraftAssetKind.Pipe,
            "Device" => DraftAssetKind.Device,
            _ => throw new DomainException("DraftAsset.UnknownKind",
                $"Draft kind '{input.Kind}' is not supported (use Node, Pipe or Device).")
        };
        var geometry = DraftGeometryFactory.FromInput(input.Geometry);
        return DraftNetworkAsset.Create(revisionId, tenantId, kind, input.AssetCode, input.ClientRef,
            geometry, input.Attributes, input.FromRef, input.ToRef, input.HostRef);
    }
}
