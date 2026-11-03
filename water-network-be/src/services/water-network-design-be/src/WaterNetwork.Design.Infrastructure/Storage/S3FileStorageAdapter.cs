using System.Buffers;
using System.Net;
using System.Text.RegularExpressions;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Application.Ports;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.Infrastructure.Storage;

/// <summary>Private S3/MinIO documents, scoped by verified tenant. Never creates buckets or ACLs.</summary>
public sealed partial class S3FileStorageAdapter(
    IAmazonS3 s3, IOptions<FileStorageOptions> options, ITenantContextAccessor tenantAccessor) : IFileStoragePort
{
    public async Task<string> SaveAsync(string fileName, string contentType, Stream content, CancellationToken ct)
    {
        var tenant = tenantAccessor.Current?.TenantId
            ?? throw UnauthorizedException.InvalidToken("Tenant context is required for document storage.");
        if (!TenantSegment().IsMatch(tenant))
            throw UnauthorizedException.InvalidToken("Tenant context cannot identify a storage namespace.");
        var settings = options.Value;
        if (content.CanSeek)
            return await SaveSeekableAsync(tenant, fileName, contentType, content, settings, ct);

        // S3 signed PutObject requires a known payload length. Non-seekable callers are
        // bounded by the same document cap before upload; normal IFormFile streams seek.
        using var buffered = new MemoryStream();
        var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
        try
        {
            int count;
            while ((count = await content.ReadAsync(buffer.AsMemory(), ct)) != 0)
            {
                if (buffered.Length + count > settings.MaxSizeBytes)
                    throw new InvalidDataException("Document exceeds the configured storage size limit.");
                await buffered.WriteAsync(buffer.AsMemory(0, count), ct);
            }
            buffered.Position = 0;
            return await SaveSeekableAsync(tenant, fileName, contentType, buffered, settings, ct);
        }
        finally { ArrayPool<byte>.Shared.Return(buffer); }
    }

    private async Task<string> SaveSeekableAsync(string tenant, string fileName, string contentType,
        Stream content, FileStorageOptions settings, CancellationToken ct)
    {
        var length = content.Length - content.Position;
        if (length <= 0 || length > settings.MaxSizeBytes)
            throw new InvalidDataException("Document is empty or exceeds the configured storage size limit.");
        var safeName = Path.GetFileName(fileName.Replace('\\', '/'));
        safeName = new string(safeName.Where(c => !char.IsControl(c)).Take(200).ToArray());
        if (string.IsNullOrWhiteSpace(safeName) || safeName is "." or "..") safeName = "document";
        var storage = settings.S3;
        var key = $"{storage.Prefix}/{tenant}/{Guid.CreateVersion7():N}/{safeName}";
        var response = await s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = storage.Bucket, Key = key, InputStream = content, ContentType = contentType,
            AutoCloseStream = false, AutoResetStreamPosition = false, UseChunkEncoding = false
        }, ct);
        if (response.HttpStatusCode != HttpStatusCode.OK)
            throw new IOException("Object storage did not acknowledge the document upload.");
        return $"s3://{storage.Bucket}/{key}";
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{1,64}$")]
    private static partial Regex TenantSegment();
}
