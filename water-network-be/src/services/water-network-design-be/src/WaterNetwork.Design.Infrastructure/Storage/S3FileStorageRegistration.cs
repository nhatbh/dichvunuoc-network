using System.Text.RegularExpressions;
using Amazon.Runtime;
using Amazon.S3;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Application.Ports;

namespace WaterNetwork.Design.Infrastructure.Storage;

public static partial class S3FileStorageRegistration
{
    public static IServiceCollection AddS3FileStorage(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<FileStorageOptions>().Bind(configuration.GetSection(FileStorageOptions.SectionName))
            .Validate(IsValid, "S3 document storage requires an absolute endpoint, bucket, region, scoped credentials, safe prefix and a size limit of at most 100 MiB. HTTP requires explicit private-network opt-in.")
            .ValidateOnStart();
        services.AddSingleton<IAmazonS3>(sp =>
        {
            var settings = sp.GetRequiredService<IOptions<FileStorageOptions>>().Value.S3;
            return new AmazonS3Client(new BasicAWSCredentials(settings.AccessKey, settings.SecretKey), new AmazonS3Config
            {
                ServiceURL = settings.ServiceUrl, AuthenticationRegion = settings.Region,
                ForcePathStyle = settings.ForcePathStyle, MaxErrorRetry = 0, Timeout = TimeSpan.FromSeconds(60),
                RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED
            });
        });
        services.AddScoped<IFileStoragePort, S3FileStorageAdapter>();
        return services;
    }

    public static bool IsValid(FileStorageOptions options)
    {
        var s3 = options.S3;
        return Uri.TryCreate(s3.ServiceUrl, UriKind.Absolute, out var uri)
            && (uri.Scheme == "https" || (uri.Scheme == "http" && s3.AllowInsecureHttp))
            && string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Query)
            && string.IsNullOrEmpty(uri.Fragment) && uri.AbsolutePath == "/"
            && BucketName().IsMatch(s3.Bucket) && PrefixName().IsMatch(s3.Prefix)
            && !s3.Prefix.Contains("//", StringComparison.Ordinal) && !s3.Prefix.EndsWith('/')
            && !string.IsNullOrWhiteSpace(s3.Region) && !string.IsNullOrWhiteSpace(s3.AccessKey)
            && !string.IsNullOrWhiteSpace(s3.SecretKey) && options.MaxSizeBytes is > 0 and <= 100L * 1024 * 1024;
    }

    [GeneratedRegex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")]
    private static partial Regex BucketName();
    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9/_-]{0,127}$")]
    private static partial Regex PrefixName();
}
