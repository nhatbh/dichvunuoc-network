using System.Net;
using System.Net.Http;

namespace WaterNetwork.Bff.UnitTests;

/// <summary>Captures the last outgoing request and returns a canned response (or throws).</summary>
public sealed class StubHttpMessageHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, HttpResponseMessage> _responder;

    public HttpRequestMessage? LastRequest { get; private set; }

    public StubHttpMessageHandler(HttpStatusCode status, string? json = null)
        => _responder = _ => new HttpResponseMessage(status)
        {
            Content = json is null ? null : new StringContent(json, System.Text.Encoding.UTF8, "application/json")
        };

    public StubHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> responder)
        => _responder = responder;

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastRequest = request;
        return Task.FromResult(_responder(request));
    }
}
