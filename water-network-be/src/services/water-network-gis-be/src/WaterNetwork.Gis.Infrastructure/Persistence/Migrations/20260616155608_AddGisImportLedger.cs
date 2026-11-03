using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WaterNetwork.Gis.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddGisImportLedger : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "gis_import_ledger",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    revision_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    draft_asset_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    gis_asset_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    asset_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_gis_import_ledger", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ux_gis_import_ledger_revision_draft",
                table: "gis_import_ledger",
                columns: new[] { "revision_id", "draft_asset_id" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "gis_import_ledger");
        }
    }
}
