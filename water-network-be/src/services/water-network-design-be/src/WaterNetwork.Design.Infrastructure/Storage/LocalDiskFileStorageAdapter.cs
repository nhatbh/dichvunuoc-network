using Microsoft.Extensions.Options;
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Application.Ports;

namespace WaterNetwork.Design.Infrastructure.Storage;

/// <summary>
/// Test/development file storage that writes to local disk and returns a relative
/// "{guid}/{fileName}" reference. Production startup rejects this provider.
/// </summary>
public sealed class LocalDiskFileStorageAdapter(IOptions<FileStorageOptions> options) : IFileStoragePort
{
    private readonly string _root = options.Value.LocalDisk.RootPath;

    public async Task<string> SaveAsync(string fileName, string contentType, Stream content, CancellationToken ct)
    {
        var safeName = Path.GetFileName(fileName); // strip any path components
        var relativeDir = Guid.CreateVersion7().ToString();
        var absoluteDir = Path.Combine(_root, relativeDir);
        Directory.CreateDirectory(absoluteDir);

        var absolutePath = Path.Combine(absoluteDir, safeName);
        await using (var dest = File.Create(absolutePath))
        {
            await content.CopyToAsync(dest, ct);
        }
        // Return a forward-slash ref so it stays portable/storage-agnostic when a real
        // adapter (S3/blob) replaces this one — Path.Combine would emit '\' on Windows.
        return $"{relativeDir}/{safeName}";
    }
}
