namespace WaterNetwork.Design.Application.Configuration;

public sealed class FileStorageOptions
{
    public const string SectionName = "FileStorage";
    public string Provider { get; set; } = "LocalDisk";
    public LocalDiskOptions LocalDisk { get; set; } = new();
    public S3StorageOptions S3 { get; set; } = new();
    public long MaxSizeBytes { get; set; } = 52_428_800; // 50 MB
    public string[] AllowedContentTypes { get; set; } = [];
}

public sealed class LocalDiskOptions
{
    public string RootPath { get; set; } = "";
}

public sealed class S3StorageOptions
{
    public string ServiceUrl { get; set; } = "";
    public string Region { get; set; } = "us-east-1";
    public string Bucket { get; set; } = "";
    public string AccessKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string Prefix { get; set; } = "design-documents";
    public bool ForcePathStyle { get; set; } = true;
    // Only enable for an explicitly private network endpoint such as in-cluster MinIO.
    public bool AllowInsecureHttp { get; set; }
}
