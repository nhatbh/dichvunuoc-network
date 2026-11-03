using WaterNetwork.Design.Application.Dtos;
using WaterPlatform.BuildingBlocks.Application.Commands;

namespace WaterNetwork.Design.Application.Commands;

public sealed record ValidateRevisionCommand(string RevisionId) : ICommand<ValidationResultDto>;
