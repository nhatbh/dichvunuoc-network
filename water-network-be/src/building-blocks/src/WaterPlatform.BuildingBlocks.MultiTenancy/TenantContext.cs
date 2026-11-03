namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public sealed record TenantContext(string TenantId, string? OrganizationId = null, string? BranchId = null);
