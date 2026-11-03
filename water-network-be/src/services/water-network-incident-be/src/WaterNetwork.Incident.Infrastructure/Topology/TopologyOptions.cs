namespace WaterNetwork.Incident.Infrastructure.Topology;

public sealed class TopologyOptions
{
    public const string SectionName = "Topology";

    /// <summary>"Grpc" (default) or "Stub".</summary>
    public string Provider { get; set; } = "Grpc";

    /// <summary>Topology-rs gRPC base address, e.g. http://water-network-topology-rs:50051.</summary>
    public string BaseUrl { get; set; } = "http://water-network-topology-rs:50051";

    /// <summary>Per-call deadline in seconds (roadmap §9.2: 5s).</summary>
    public int DeadlineSeconds { get; set; } = 5;
}
