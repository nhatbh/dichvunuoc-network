using System.Text.Json;
using FluentAssertions;
using WaterNetwork.Design.Contracts;
using WaterNetwork.Design.Contracts.Events;

namespace WaterNetwork.Design.ContractTests;

public sealed class DesignDocumentUploadedContractTests
{
    [Fact]
    public void V1_Payload_Schema_Is_Stable()
    {
        var evt = new DesignDocumentUploadedV1("d1", "p1", "tenant-1", "plan.pdf", "application/pdf", 123, "ref/x", "Pdf");
        var json = JsonSerializer.Serialize(evt);
        using var doc = JsonDocument.Parse(json);
        doc.RootElement.EnumerateObject().Select(p => p.Name)
            .Should().Equal("DocumentId", "ProjectId", "TenantId", "FileName", "ContentType", "SizeBytes", "FileRef", "DocumentType");
    }

    [Fact]
    public void EventType_Is_Fixed() => DesignEventTypes.DocumentUploaded.Should().Be("design.document.uploaded");
}
