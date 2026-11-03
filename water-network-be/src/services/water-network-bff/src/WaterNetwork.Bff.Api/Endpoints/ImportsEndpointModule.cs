using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Options;
using WaterNetwork.Bff.Api.Configuration;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.Security;
using WaterPlatform.BuildingBlocks.WebApi.Endpoints;

namespace WaterNetwork.Bff.Api.Endpoints;

public sealed class ImportsEndpointModule : IEndpointModule
{
    public const long MaxRequestBytes = 100L * 1024 * 1024;
    private static readonly string[] ReadMethods = ["GET", "HEAD"];
    private static readonly string[] WriteMethods = ["POST", "PUT", "PATCH", "DELETE"];
    private static readonly HashSet<string> HopHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Connection", "Transfer-Encoding", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization",
        "TE", "Trailer", "Upgrade", "Proxy-Connection"
    };

    public void MapEndpoints(IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/gis/imports");
        foreach (var path in new[] { "", "/{**path}" })
        {
            group.MapMethods(path, ReadMethods, ProxyAsync).RequirePermission("network-design:read");
            group.MapMethods(path, WriteMethods, ProxyAsync).RequirePermission("network-design:write");
        }
        group.MapPost("/{jobId}/publish", ProxyAsync).RequirePermission("network-design:approve");
    }

    private static async Task ProxyAsync(HttpContext context, IHttpClientFactory clients, IOptions<DownstreamOptions> options)
    {
        var baseUrl = options.Value.Import.BaseUrl;
        if (!DownstreamOptionsValidation.IsAbsoluteHttpUrl(baseUrl))
        {
            await Results.Problem("CAD import service is not configured.", statusCode: 503).ExecuteAsync(context);
            return;
        }
        if (context.Request.ContentLength > MaxRequestBytes)
        {
            await Results.Problem("Upload exceeds the 100 MiB limit.", statusCode: 413).ExecuteAsync(context);
            return;
        }
        var limit = context.Features.Get<IHttpMaxRequestBodySizeFeature>();
        if (limit is { IsReadOnly: false }) limit.MaxRequestBodySize = MaxRequestBytes;

        // Preserve the worker's route and query, and never accept a caller-supplied destination.
        var target = new Uri(new Uri(baseUrl.TrimEnd('/') + "/"), context.Request.Path.ToUriComponent().TrimStart('/') + context.Request.QueryString);
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), target);
        foreach (var name in new[] { "Authorization", "Accept", "X-Correlation-Id", "Idempotency-Key" })
            if (context.Request.Headers.TryGetValue(name, out var value))
                request.Headers.TryAddWithoutValidation(name, value.ToArray());
        if (!request.Headers.Contains("X-Correlation-Id")
            && context.Items.TryGetValue("RequestContext", out var item) && item is RequestContext rc)
            request.Headers.TryAddWithoutValidation("X-Correlation-Id", rc.CorrelationId);

        if (context.Features.Get<IHttpRequestBodyDetectionFeature>()?.CanHaveBody == true
            || context.Request.ContentLength > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
        {
            request.Content = new StreamContent(new BoundedUploadStream(context.Request.Body, MaxRequestBytes));
            foreach (var header in context.Request.Headers.Where(h => h.Key.StartsWith("Content-", StringComparison.OrdinalIgnoreCase)))
                request.Content.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        timeout.CancelAfter(TimeSpan.FromSeconds(120));
        try
        {
            using var upstream = await clients.CreateClient("cad-import")
                .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            context.Response.StatusCode = (int)upstream.StatusCode;
            var excluded = new HashSet<string>(HopHeaders, StringComparer.OrdinalIgnoreCase);
            foreach (var connection in upstream.Headers.Connection)
                foreach (var header in connection.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                    excluded.Add(header);
            foreach (var header in upstream.Headers.Concat(upstream.Content.Headers))
                if (!excluded.Contains(header.Key)) context.Response.Headers[header.Key] = header.Value.ToArray();
            if (!HttpMethods.IsHead(context.Request.Method))
                await upstream.Content.CopyToAsync(context.Response.Body, timeout.Token);
        }
        catch (Exception ex) when (IsTooLarge(ex))
        {
            await FailAsync(context, 413, "Upload exceeds the 100 MiB limit.");
        }
        catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested)
        {
            await FailAsync(context, 504, "CAD import service timed out.");
        }
        catch (HttpRequestException)
        {
            await FailAsync(context, 502, "CAD import service is unavailable.");
        }
    }

    private static bool IsTooLarge(Exception? exception)
    {
        while (exception is not null)
        {
            if (exception is BadHttpRequestException { StatusCode: 413 }) return true;
            exception = exception.InnerException;
        }
        return false;
    }

    private static async Task FailAsync(HttpContext context, int status, string detail)
    {
        if (context.Response.HasStarted) { context.Abort(); return; }
        context.Response.Clear();
        await Results.Problem(detail, statusCode: status).ExecuteAsync(context);
    }
}

// Caps chunked uploads too. Disposing the outbound content never owns the inbound request body.
internal sealed class BoundedUploadStream(Stream source, long maximum) : Stream
{
    private long _read;
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => _read; set => throw new NotSupportedException(); }
    public override int Read(byte[] buffer, int offset, int count)
    {
        var read = source.Read(buffer, offset, (int)Math.Min(count, maximum - _read + 1));
        Account(read);
        return read;
    }
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        var read = await source.ReadAsync(buffer[..(int)Math.Min(buffer.Length, maximum - _read + 1)], cancellationToken);
        Account(read);
        return read;
    }
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        => ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();
    private void Account(int count)
    {
        _read += count;
        if (_read > maximum) throw new BadHttpRequestException("Upload too large.", 413);
    }
    public override void Flush() => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}
