using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

namespace WaterNetwork.Gis.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:postgis", ",,");

            migrationBuilder.CreateTable(
                name: "idempotency_entries",
                columns: table => new
                {
                    Key = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    Result = table.Column<string>(type: "text", nullable: true),
                    ProcessedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_idempotency_entries", x => x.Key);
                });

            migrationBuilder.CreateTable(
                name: "network_nodes",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    asset_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    node_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    location = table.Column<Point>(type: "geometry(Point,4326)", nullable: false),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    deleted_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_network_nodes", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "outbox_entries",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    AggregateId = table.Column<string>(type: "text", nullable: false),
                    AggregateType = table.Column<string>(type: "text", nullable: false),
                    EventType = table.Column<string>(type: "text", nullable: false),
                    EventVersion = table.Column<int>(type: "integer", nullable: false),
                    Payload = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ProcessedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RetryCount = table.Column<int>(type: "integer", nullable: false),
                    LastError = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_outbox_entries", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "processed_events",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ProjectionName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    EventId = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: false),
                    ProcessedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_processed_events", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_idempotency_entries_ProcessedAt",
                table: "idempotency_entries",
                column: "ProcessedAt");

            migrationBuilder.CreateIndex(
                name: "ix_network_nodes_location_gist",
                table: "network_nodes",
                column: "location")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "ux_network_nodes_tenant_asset_code",
                table: "network_nodes",
                columns: new[] { "tenant_id", "asset_code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_outbox_entries_AggregateId",
                table: "outbox_entries",
                column: "AggregateId");

            migrationBuilder.CreateIndex(
                name: "IX_outbox_entries_Status_CreatedAt",
                table: "outbox_entries",
                columns: new[] { "Status", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_processed_events_ProcessedAt",
                table: "processed_events",
                column: "ProcessedAt");

            migrationBuilder.CreateIndex(
                name: "IX_processed_events_ProjectionName_EventId",
                table: "processed_events",
                columns: new[] { "ProjectionName", "EventId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "idempotency_entries");

            migrationBuilder.DropTable(
                name: "network_nodes");

            migrationBuilder.DropTable(
                name: "outbox_entries");

            migrationBuilder.DropTable(
                name: "processed_events");
        }
    }
}
