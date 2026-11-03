namespace WaterNetwork.Design.Contracts;

public static class DesignEventTypes
{
    public const string ProjectCreated = "design.project.created";
    public const string DocumentUploaded = "design.document.uploaded";
    public const string RevisionCreated = "design.revision.created";
    public const string RevisionValidated = "design.revision.validated";
    public const string RevisionSubmitted = "design.revision.submitted";
    public const string RevisionApproved = "design.revision.approved";
    public const string RevisionRejected = "design.revision.rejected";
    public const string AssetReadyForGis = "design.asset.ready-for-gis";
    public const string RevisionPublished = "design.revision.published";
}
