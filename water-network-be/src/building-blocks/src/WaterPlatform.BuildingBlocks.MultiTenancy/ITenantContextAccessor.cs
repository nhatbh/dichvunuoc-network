namespace WaterPlatform.BuildingBlocks.MultiTenancy;

/// <summary>
/// Provides read-only access to the ambient <see cref="TenantContext"/> for the current async execution flow.
/// </summary>
public interface ITenantContextAccessor
{
    TenantContext? Current { get; }
}
