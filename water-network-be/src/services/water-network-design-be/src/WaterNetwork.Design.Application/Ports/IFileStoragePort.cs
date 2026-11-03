namespace WaterNetwork.Design.Application.Ports;

/// <summary>
/// Abstraction over file storage. Local disk is restricted to test/development; production
/// uses private S3/MinIO object storage with scoped credentials.
/// </summary>
public interface IFileStoragePort
{
    /// <summary>Stores the content and returns an opaque storage reference (key/path).</summary>
    Task<string> SaveAsync(string fileName, string contentType, Stream content, CancellationToken ct);
}
