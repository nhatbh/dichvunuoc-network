using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WaterNetwork.Design.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDesignImportResults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "design_import_results",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    revision_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    draft_asset_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    gis_asset_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    reason = table.Column<string>(type: "text", nullable: true),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_design_import_results", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_design_import_results_tenant_revision",
                table: "design_import_results",
                columns: new[] { "tenant_id", "revision_id" });

            migrationBuilder.CreateIndex(
                name: "ux_design_import_results_revision_draft",
                table: "design_import_results",
                columns: new[] { "revision_id", "draft_asset_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "design_import_results");
        }
    }
}
