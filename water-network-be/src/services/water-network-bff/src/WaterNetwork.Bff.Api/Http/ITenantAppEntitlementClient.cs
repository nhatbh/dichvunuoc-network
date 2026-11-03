namespace WaterNetwork.Bff.Api.Http;

public enum TenantAppAccessStatus
{
    Allowed,
    Denied,
    Unavailable,
}

public interface ITenantAppEntitlementClient
{
    Task<TenantAppAccessStatus> CheckAccessAsync(string appCode, CancellationToken cancellationToken);
}
