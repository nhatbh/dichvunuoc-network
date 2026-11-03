using System.Diagnostics.CodeAnalysis;

namespace WaterPlatform.BuildingBlocks.MultiTenancy;

public sealed class TenantContextAccessor : ITenantContextAccessor
{
    private static readonly AsyncLocal<TenantContext?> Holder = new();

    public TenantContext? Current => Holder.Value;

    // SetContext is an intentional instance method; it must remain instance-level so that
    // TenantResolutionMiddleware can be injected with the concrete type from DI.
    [SuppressMessage("Performance", "CA1822:Mark members as static",
        Justification = "Intentional instance method; DI injects the concrete type into middleware.")]
    public void SetContext(TenantContext? context) => Holder.Value = context;
}
