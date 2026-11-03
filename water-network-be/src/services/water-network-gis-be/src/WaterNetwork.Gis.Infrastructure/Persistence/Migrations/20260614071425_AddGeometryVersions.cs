using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

namespace WaterNetwork.Gis.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddGeometryVersions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "geometry_versions",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    asset_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    asset_kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    geometry = table.Column<Geometry>(type: "geometry(Geometry,4326)", nullable: true),
                    geojson = table.Column<string>(type: "text", nullable: false),
                    changed_by = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    reason = table.Column<string>(type: "text", nullable: true),
                    changed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_geometry_versions", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ux_geometry_versions_asset_version",
                table: "geometry_versions",
                columns: new[] { "asset_id", "version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "geometry_versions");
        }
    }
}
