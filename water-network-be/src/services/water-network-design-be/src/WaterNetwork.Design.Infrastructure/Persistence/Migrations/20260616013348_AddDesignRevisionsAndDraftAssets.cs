using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

namespace WaterNetwork.Design.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDesignRevisionsAndDraftAssets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:postgis", ",,");

            migrationBuilder.CreateTable(
                name: "design_revisions",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    project_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    revision_number = table.Column<int>(type: "integer", nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    validation_result = table.Column<string>(type: "jsonb", nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_design_revisions", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "draft_network_assets",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    revision_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    draft_kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    asset_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    client_ref = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    geometry = table.Column<Geometry>(type: "geometry(Geometry,4326)", nullable: false),
                    attributes = table.Column<string>(type: "jsonb", nullable: false),
                    from_ref = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    to_ref = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    host_ref = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_draft_network_assets", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_design_revisions_tenant_project",
                table: "design_revisions",
                columns: new[] { "tenant_id", "project_id" });

            migrationBuilder.CreateIndex(
                name: "ux_design_revisions_tenant_project_number",
                table: "design_revisions",
                columns: new[] { "tenant_id", "project_id", "revision_number" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_draft_assets_revision_code",
                table: "draft_network_assets",
                columns: new[] { "revision_id", "asset_code" });

            migrationBuilder.CreateIndex(
                name: "ix_draft_assets_tenant_revision",
                table: "draft_network_assets",
                columns: new[] { "tenant_id", "revision_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "design_revisions");

            migrationBuilder.DropTable(
                name: "draft_network_assets");

            migrationBuilder.AlterDatabase()
                .OldAnnotation("Npgsql:PostgresExtension:postgis", ",,");
        }
    }
}
