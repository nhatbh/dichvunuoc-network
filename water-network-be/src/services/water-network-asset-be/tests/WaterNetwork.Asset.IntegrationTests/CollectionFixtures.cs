using WaterPlatform.BuildingBlocks.Testing;
using Xunit;

namespace WaterNetwork.Asset.IntegrationTests;

#pragma warning disable CA1711 // xUnit CollectionDefinition classes are required to end in 'Collection'
[CollectionDefinition("real-broker")]
public sealed class RealBrokerCollection : ICollectionFixture<PostgisFixture>, ICollectionFixture<RabbitMqFixture> { }
#pragma warning restore CA1711
