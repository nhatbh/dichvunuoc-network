using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WaterNetwork.Design.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDesignImportReceipts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "design_import_receipts",
                columns: table => new
                {
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    import_key = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    payload_sha256 = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    project_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    revision_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    asset_count = table.Column<int>(type: "integer", nullable: false),
                    provenance = table.Column<string>(type: "jsonb", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_design_import_receipts", x => new { x.tenant_id, x.import_key });
                    table.ForeignKey(
                        name: "FK_design_import_receipts_design_projects_project_id",
                        column: x => x.project_id,
                        principalTable: "design_projects",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_design_import_receipts_design_revisions_revision_id",
                        column: x => x.revision_id,
                        principalTable: "design_revisions",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_design_import_receipts_project_id",
                table: "design_import_receipts",
                column: "project_id");

            migrationBuilder.CreateIndex(
                name: "IX_design_import_receipts_revision_id",
                table: "design_import_receipts",
                column: "revision_id");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "design_import_receipts");
        }
    }
}
