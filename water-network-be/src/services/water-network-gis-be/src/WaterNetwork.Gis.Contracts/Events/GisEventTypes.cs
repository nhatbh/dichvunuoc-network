namespace WaterNetwork.Gis.Contracts.Events;

public static class GisEventTypes
{
    public const string NodeRegistered = "network.node.registered";
    public const string PipeRegistered = "network.pipe.registered";
    public const string DeviceInstalled = "network.device.installed";
    public const string NodeDeleted = "network.node.deleted";
    public const string PipeDeleted = "network.pipe.deleted";
    public const string DeviceDeleted = "network.device.deleted";
    public const string NodeRelocated = "network.node.relocated";
    public const string GisImportCompleted = "network.gis-import.completed";
}
