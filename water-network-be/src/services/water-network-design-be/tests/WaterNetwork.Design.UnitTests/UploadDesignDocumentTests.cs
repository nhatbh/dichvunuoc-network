using FluentAssertions;
using NSubstitute;
using WaterNetwork.Design.Application.Commands;
using WaterNetwork.Design.Domain.Aggregates;
using WaterNetwork.Design.Domain.DomainEvents;
using WaterNetwork.Design.Domain.Repositories;
using WaterPlatform.BuildingBlocks.Application.Context;
using WaterPlatform.BuildingBlocks.MultiTenancy;

namespace WaterNetwork.Design.UnitTests;

public sealed class UploadDesignDocumentTests
{
    [Fact]
    public void Document_Create_Raises_Uploaded_Event()
    {
        var d = DesignDocument.Create("proj-1", "tenant-1", "plan.pdf", "application/pdf", 123, "ref/x", "Pdf", "user-9");

        d.ProjectId.Should().Be("proj-1");
        d.FileRef.Should().Be("ref/x");
        d.SizeBytes.Should().Be(123);
        var evt = d.GetDomainEvents().OfType<DesignDocumentUploaded>().Single();
        evt.Data.ProjectId.Should().Be("proj-1");
        evt.Data.FileRef.Should().Be("ref/x");
        evt.Data.DocumentType.Should().Be("Pdf");
    }

    [Fact]
    public async Task Handler_Persists_Document_With_Actor()
    {
        var repo = Substitute.For<IDesignDocumentRepository>();
        var tenant = Substitute.For<ITenantContextAccessor>();
        tenant.Current.Returns(new TenantContext("tenant-1"));
        var reqCtx = Substitute.For<IRequestContextProvider>();
        reqCtx.Current().Returns(new RequestContext(CorrelationId: "c1", UserId: "user-9"));

        var handler = new UploadDesignDocumentCommandHandler(repo, tenant, reqCtx);
        var id = await handler.HandleAsync(
            new UploadDesignDocumentCommand("proj-1", "plan.pdf", "application/pdf", 123, "ref/x", "Pdf"), CancellationToken.None);

        id.Should().NotBeNullOrWhiteSpace();
        await repo.Received(1).SaveAsync(Arg.Is<DesignDocument>(d => d.UploadedBy == "user-9" && d.ProjectId == "proj-1"), Arg.Any<CancellationToken>());
    }
}
