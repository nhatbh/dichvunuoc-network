using System.Net;
using Amazon.S3;
using Amazon.S3.Model;
using FluentAssertions;
using Microsoft.Extensions.Options;
using NSubstitute;
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Infrastructure.Storage;
using WaterPlatform.BuildingBlocks.Domain.Exceptions;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.UnitTests;

public sealed class S3FileStorageAdapterTests
{
    private static FileStorageOptions Settings() => new()
    {
        Provider = "S3", MaxSizeBytes = 100,
        S3 = new() { ServiceUrl = "https://minio.example", Bucket = "design", AccessKey = "write-only", SecretKey = "test-value" }
    };

    [Fact]
    public async Task Stores_with_tenant_scope_safe_name_private_defaults_and_leaves_input_open()
    {
        var s3 = Substitute.For<IAmazonS3>();
        s3.PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns(new PutObjectResponse { HttpStatusCode = HttpStatusCode.OK });
        var tenant = Substitute.For<ITenantContextAccessor>();
        tenant.Current.Returns(new TenantContext("tnt_shw"));
        var adapter = new S3FileStorageAdapter(s3, Options.Create(Settings()), tenant);
        await using var stream = new MemoryStream([1, 2, 3]);
        var result = await adapter.SaveAsync("C:\\drawings\\network.dwg", "image/vnd.dwg", stream, CancellationToken.None);
        result.Should().StartWith("s3://design/design-documents/tnt_shw/").And.EndWith("/network.dwg");
        stream.CanRead.Should().BeTrue();
        await s3.Received(1).PutObjectAsync(Arg.Is<PutObjectRequest>(r =>
            r.BucketName == "design" && r.Key.StartsWith("design-documents/tnt_shw/", StringComparison.Ordinal)
            && r.ContentType == "image/vnd.dwg" && !r.AutoCloseStream && !r.AutoResetStreamPosition
            && r.InputStream == stream && !r.UseChunkEncoding), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task Missing_tenant_or_oversize_stream_never_reaches_storage()
    {
        var s3 = Substitute.For<IAmazonS3>();
        var tenant = Substitute.For<ITenantContextAccessor>();
        var adapter = new S3FileStorageAdapter(s3, Options.Create(Settings()), tenant);
        await using var stream = new MemoryStream(new byte[101]);
        await FluentActions.Invoking(() => adapter.SaveAsync("network.dwg", "image/vnd.dwg", stream, default))
            .Should().ThrowAsync<UnauthorizedException>();
        tenant.Current.Returns(new TenantContext("tnt_shw"));
        await FluentActions.Invoking(() => adapter.SaveAsync("network.dwg", "image/vnd.dwg", stream, default))
            .Should().ThrowAsync<InvalidDataException>();
        await s3.DidNotReceive().PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task S3_failure_propagates_without_success_reference()
    {
        var s3 = Substitute.For<IAmazonS3>();
        s3.PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns<Task<PutObjectResponse>>(_ => throw new AmazonS3Exception("AccessDenied"));
        var tenant = Substitute.For<ITenantContextAccessor>();
        tenant.Current.Returns(new TenantContext("tnt_shw"));
        var adapter = new S3FileStorageAdapter(s3, Options.Create(Settings()), tenant);
        await using var stream = new MemoryStream([1]);
        await FluentActions.Invoking(() => adapter.SaveAsync("network.dwg", "image/vnd.dwg", stream, default))
            .Should().ThrowAsync<AmazonS3Exception>();
    }

    [Fact]
    public void Configuration_requires_credentials_bucket_and_explicit_private_http_opt_in()
    {
        var settings = Settings();
        S3FileStorageRegistration.IsValid(settings).Should().BeTrue();
        settings.S3.ServiceUrl = "http://minio:9000";
        S3FileStorageRegistration.IsValid(settings).Should().BeFalse();
        settings.S3.AllowInsecureHttp = true;
        S3FileStorageRegistration.IsValid(settings).Should().BeTrue();
        settings.S3.SecretKey = "";
        S3FileStorageRegistration.IsValid(settings).Should().BeFalse();
    }
    [Fact]
    public async Task Non_seekable_input_is_bounded_before_any_upload()
    {
        var s3 = Substitute.For<IAmazonS3>();
        s3.PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>())
            .Returns(new PutObjectResponse { HttpStatusCode = HttpStatusCode.OK });
        var tenant = Substitute.For<ITenantContextAccessor>();
        tenant.Current.Returns(new TenantContext("tnt_shw"));
        var adapter = new S3FileStorageAdapter(s3, Options.Create(Settings()), tenant);
        using var oversized = new NonSeekableStream(new byte[101]);
        await FluentActions.Invoking(() => adapter.SaveAsync("network.dwg", "image/vnd.dwg", oversized, default))
            .Should().ThrowAsync<InvalidDataException>();
        await s3.DidNotReceive().PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>());
        using var bounded = new NonSeekableStream([1, 2, 3]);
        (await adapter.SaveAsync("network.dwg", "image/vnd.dwg", bounded, default)).Should().StartWith("s3://design/");
        await s3.Received(1).PutObjectAsync(Arg.Any<PutObjectRequest>(), Arg.Any<CancellationToken>());
    }

    private sealed class NonSeekableStream(byte[] data) : MemoryStream(data)
    {
        public override bool CanSeek => false;
    }

}
