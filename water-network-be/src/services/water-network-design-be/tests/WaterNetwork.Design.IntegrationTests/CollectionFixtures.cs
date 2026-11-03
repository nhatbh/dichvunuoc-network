using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Design.IntegrationTests;

#pragma warning disable CA1711 // xUnit CollectionDefinition classes are required to end in 'Collection'
[CollectionDefinition("design-postgis")]
public sealed class DesignPostgisCollection : ICollectionFixture<PostgisFixture> { }
#pragma warning restore CA1711
