namespace WaterNetwork.Design.Contracts.Requests;

public sealed record CreateDesignProjectRequest(string Name, string? BranchId, string? ZoneId);
