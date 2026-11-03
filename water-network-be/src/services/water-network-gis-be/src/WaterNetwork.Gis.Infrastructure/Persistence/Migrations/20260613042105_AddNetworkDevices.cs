using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

namespace WaterNetwork.Gis.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddNetworkDevices : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "network_devices",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    asset_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    device_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    host_pipe_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    host_node_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    location = table.Column<Point>(type: "geometry(Point,4326)", nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false, defaultValue: "Active"),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_network_devices", x => x.id);
                });

            migrationBuilder.CreateIndex(
                name: "ix_network_devices_host_node",
                table: "network_devices",
                columns: new[] { "tenant_id", "host_node_id" });

            migrationBuilder.CreateIndex(
                name: "ix_network_devices_host_pipe",
                table: "network_devices",
                columns: new[] { "tenant_id", "host_pipe_id" });

            migrationBuilder.CreateIndex(
                name: "ix_network_devices_location_gist",
                table: "network_devices",
                column: "location")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "ux_network_devices_tenant_asset_code",
                table: "network_devices",
                columns: new[] { "tenant_id", "asset_code" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "network_devices");
        }
    }
}
