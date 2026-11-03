using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WaterNetwork.Design.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDesignDsn2ForeignKeys : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_design_revisions_project_id",
                table: "design_revisions",
                column: "project_id");

            migrationBuilder.AddForeignKey(
                name: "FK_design_revisions_design_projects_project_id",
                table: "design_revisions",
                column: "project_id",
                principalTable: "design_projects",
                principalColumn: "id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_draft_network_assets_design_revisions_revision_id",
                table: "draft_network_assets",
                column: "revision_id",
                principalTable: "design_revisions",
                principalColumn: "id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_design_revisions_design_projects_project_id",
                table: "design_revisions");

            migrationBuilder.DropForeignKey(
                name: "FK_draft_network_assets_design_revisions_revision_id",
                table: "draft_network_assets");

            migrationBuilder.DropIndex(
                name: "IX_design_revisions_project_id",
                table: "design_revisions");
        }
    }
}
