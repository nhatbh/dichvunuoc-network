using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

namespace WaterNetwork.Gis.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNetworkPipes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "network_pipes",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    asset_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    from_node_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    to_node_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    geometry = table.Column<LineString>(type: "geometry(LineString,4326)", nullable: false),
                    diameter_mm = table.Column<int>(type: "integer", nullable: false),
                    material = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    length_m = table.Column<double>(type: "double precision", nullable: false),
                    length_validation_warning = table.Column<string>(type: "text", nullable: true),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "Active"),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_network_pipes", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_network_pipes_from_to",
                table: "network_pipes",
                columns: new[] { "tenant_id", "from_node_id", "to_node_id" });

            migrationBuilder.CreateIndex(
                name: "ix_network_pipes_geometry_gist",
                table: "network_pipes",
                column: "geometry")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "ux_network_pipes_tenant_asset_code",
                table: "network_pipes",
                columns: new[] { "tenant_id", "asset_code" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "network_pipes");
        }
    }
}
