using WaterPlatform.BuildingBlocks.Testing;

namespace WaterNetwork.Incident.IntegrationTests;

#pragma warning disable CA1711 // xUnit CollectionDefinition classes are required to end in 'Collection'
[CollectionDefinition("incident-postgis")]
public sealed class IncidentPostgisCollection : ICollectionFixture<PostgisFixture> { }
#pragma warning restore CA1711
