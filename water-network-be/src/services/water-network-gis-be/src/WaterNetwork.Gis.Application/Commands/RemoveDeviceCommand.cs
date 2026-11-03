using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Gis.Application.Commands;

public sealed record RemoveDeviceCommand(string DeviceId) : ICommand<Unit>;
