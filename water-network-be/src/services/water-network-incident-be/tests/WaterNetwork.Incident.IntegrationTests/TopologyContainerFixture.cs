using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using DotNet.Testcontainers.Images;

namespace WaterNetwork.Incident.IntegrationTests;

public sealed class TopologyContainerFixture : IAsyncLifetime
{
    private IFutureDockerImage _image = default!;
    private IContainer _container = default!;

    public string GrpcAddress { get; private set; } = default!;

    public async Task InitializeAsync()
    {
        _image = new ImageFromDockerfileBuilder()
            .WithDockerfileDirectory(CommonDirectoryPath.GetGitDirectory(), string.Empty)
            .WithDockerfile("src/services/water-network-topology-rs/Dockerfile")
            .WithName("water-network-topology-rs:inc2-contract")
            .WithCleanUp(false)
            .Build();
        await _image.CreateAsync();

        _container = new ContainerBuilder(_image)
            // Unreachable broker: the consumer loop retries every 5s; the gRPC server (spawned first) still serves.
            .WithEnvironment("TOPOLOGY_AMQP_URL", "amqp://guest:guest@127.0.0.1:1/%2f")
            .WithEnvironment("TOPOLOGY_GRPC_BIND", "0.0.0.0:50051")
            .WithEnvironment("TOPOLOGY_HTTP_BIND", "0.0.0.0:8080")
            .WithPortBinding(50051, true)
            .WithWaitStrategy(Wait.ForUnixContainer().UntilInternalTcpPortIsAvailable(50051))
            .Build();
        await _container.StartAsync();

        GrpcAddress = $"http://{_container.Hostname}:{_container.GetMappedPublicPort(50051)}";
    }

    public async Task DisposeAsync()
    {
        if (_container is not null) await _container.DisposeAsync();
        if (_image is not null) await _image.DisposeAsync();
    }
}
