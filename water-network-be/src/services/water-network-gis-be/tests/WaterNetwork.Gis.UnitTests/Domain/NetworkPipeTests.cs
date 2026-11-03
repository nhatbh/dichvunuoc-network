using FluentAssertions;
using WaterNetwork.Gis.Domain.Aggregates;
using WaterNetwork.Gis.Domain.DomainEvents;
using WaterNetwork.Gis.Domain.ValueObjects;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using Xunit;

namespace WaterNetwork.Gis.UnitTests.Domain;

public class NetworkPipeTests
{
    private static readonly string TenantId = "tenant-001";
    private static readonly AssetCode AssetCode = new("PP-001");
    private static readonly string FromNodeId = "node-abc";
    private static readonly string ToNodeId = "node-def";
    private static readonly PipeGeometry Geometry = new(new[]
    {
        new GeoPoint(10.762622, 106.660172),
        new GeoPoint(10.763000, 106.661000)
    });
    private static readonly Diameter DiameterMm = new(150);
    private static readonly PipeMaterial Material = PipeMaterial.Parse("HDPE");
    private const double LengthM = 120.5;

    private static NetworkPipe MakePipe() => NetworkPipe.Register(
        tenantId: TenantId,
        assetCode: AssetCode,
        fromNodeId: FromNodeId,
        toNodeId: ToNodeId,
        geometry: Geometry,
        diameterMm: DiameterMm,
        material: Material,
        lengthM: LengthM,
        lengthValidationWarning: null);

    [Fact]
    public void Register_WithSameFromAndToNodeId_ThrowsDomainException_SelfLoop()
    {
        var act = () => NetworkPipe.Register(
            tenantId: TenantId,
            assetCode: AssetCode,
            fromNodeId: "node-same",
            toNodeId: "node-same",
            geometry: Geometry,
            diameterMm: DiameterMm,
            material: Material,
            lengthM: LengthM,
            lengthValidationWarning: null);

        act.Should().Throw<DomainException>()
            .Which.Code.Should().Be("NetworkPipe.SelfLoop");
    }

    [Fact]
    public void Register_ValidArgs_CreatesIdWithPipePrefix()
    {
        var pipe = NetworkPipe.Register(
            tenantId: TenantId,
            assetCode: AssetCode,
            fromNodeId: FromNodeId,
            toNodeId: ToNodeId,
            geometry: Geometry,
            diameterMm: DiameterMm,
            material: Material,
            lengthM: LengthM,
            lengthValidationWarning: null);

        pipe.Id.Should().StartWith("pipe-");
    }

    [Fact]
    public void Register_ValidArgs_RaisesExactlyOnePipeRegisteredEvent()
    {
        var pipe = NetworkPipe.Register(
            tenantId: TenantId,
            assetCode: AssetCode,
            fromNodeId: FromNodeId,
            toNodeId: ToNodeId,
            geometry: Geometry,
            diameterMm: DiameterMm,
            material: Material,
            lengthM: LengthM,
            lengthValidationWarning: null);

        var events = pipe.GetDomainEvents().OfType<PipeRegistered>().ToList();
        events.Should().HaveCount(1);

        var evt = events.Single();
        evt.AggregateId.Should().Be(pipe.Id);
        evt.EventType.Should().Be("PipeRegistered");
        evt.Data.TenantId.Should().Be(TenantId);
        evt.Data.AssetCode.Should().Be("PP-001");
        evt.Data.FromNodeId.Should().Be(FromNodeId);
        evt.Data.ToNodeId.Should().Be(ToNodeId);
        evt.Data.Points.Should().BeEquivalentTo(Geometry.Points);
        evt.Data.DiameterMm.Should().Be(150);
        evt.Data.Material.Should().Be("HDPE");
        evt.Data.LengthM.Should().Be(LengthM);
    }

    [Fact]
    public void Register_Generates_TimeOrdered_UuidV7_Id()
    {
        var first = NetworkPipe.Register(
            TenantId, AssetCode, FromNodeId, ToNodeId,
            Geometry, DiameterMm, Material, LengthM, lengthValidationWarning: null);
        Thread.Sleep(2);
        var second = NetworkPipe.Register(
            TenantId, AssetCode, FromNodeId, ToNodeId,
            Geometry, DiameterMm, Material, LengthM, lengthValidationWarning: null);

        Guid.ParseExact(first.Id["pipe-".Length..], "N").Version.Should().Be(7);
        string.CompareOrdinal(first.Id, second.Id).Should().BeNegative(
            "uuid v7 ids generated later must sort after earlier ones");
    }

    [Fact]
    public void Reconstitute_DoesNotRaiseEvents()
    {
        var pipe = NetworkPipe.Reconstitute(
            id: "pipe-abc123",
            tenantId: TenantId,
            assetCode: AssetCode,
            fromNodeId: FromNodeId,
            toNodeId: ToNodeId,
            geometry: Geometry,
            diameterMm: DiameterMm,
            material: Material,
            lengthM: LengthM,
            lengthValidationWarning: null,
            version: 5,
            createdAt: DateTime.UtcNow,
            updatedAt: DateTime.UtcNow);

        pipe.GetDomainEvents().Should().BeEmpty();
        pipe.Version.Should().Be(5);
    }

    [Fact]
    public void SoftDelete_Stamps_DeletedAt_And_Raises_PipeDeleted()
    {
        var pipe = MakePipe();
        pipe.ClearDomainEvents();
        var before = pipe.Version;

        pipe.SoftDelete();

        pipe.DeletedAt.Should().NotBeNull();
        pipe.Version.Should().Be(before + 1);
        var evt = pipe.GetDomainEvents().Single().Should().BeOfType<PipeDeleted>().Subject;
        evt.AggregateId.Should().Be(pipe.Id);
        evt.Data.TenantId.Should().Be(TenantId);
        evt.Data.AssetCode.Should().Be(AssetCode.Value);
    }
}
