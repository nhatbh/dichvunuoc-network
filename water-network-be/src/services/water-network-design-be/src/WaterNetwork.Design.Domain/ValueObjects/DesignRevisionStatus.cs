// DesignRevisionStatus.cs
namespace WaterNetwork.Design.Domain.ValueObjects;

public enum DesignRevisionStatus
{
    Draft,
    Validated,
    Submitted,
    Approved,
    Published,
    PartiallyPublished
}
