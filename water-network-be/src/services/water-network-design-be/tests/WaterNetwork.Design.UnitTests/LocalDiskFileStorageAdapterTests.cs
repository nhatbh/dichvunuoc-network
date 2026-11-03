using System.Text;
using FluentAssertions;
using Microsoft.Extensions.Options;
using WaterNetwork.Design.Application.Configuration;
using WaterNetwork.Design.Infrastructure.Storage;

namespace WaterNetwork.Design.UnitTests;

public sealed class LocalDiskFileStorageAdapterTests
{
    [Fact]
    public async Task Save_Writes_File_And_Returns_Ref()
    {
        var root = Path.Combine(Path.GetTempPath(), "wn-design-ut", Guid.CreateVersion7().ToString());
        var opts = Options.Create(new FileStorageOptions { LocalDisk = new LocalDiskOptions { RootPath = root } });
        var adapter = new LocalDiskFileStorageAdapter(opts);

        using var content = new MemoryStream(Encoding.UTF8.GetBytes("hello"));
        var fileRef = await adapter.SaveAsync("plan.pdf", "application/pdf", content, CancellationToken.None);

        fileRef.Should().NotBeNullOrWhiteSpace();
        File.Exists(Path.Combine(root, fileRef)).Should().BeTrue();
        (await File.ReadAllTextAsync(Path.Combine(root, fileRef))).Should().Be("hello");
    }
}
