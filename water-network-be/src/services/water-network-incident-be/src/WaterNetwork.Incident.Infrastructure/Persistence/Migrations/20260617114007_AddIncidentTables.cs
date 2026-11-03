using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;

#nullable disable

namespace WaterNetwork.Incident.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddIncidentTables : Migration
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
                name: "network_incidents",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    category = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    severity = table.Column<int>(type: "integer", nullable: false),
                    longitude = table.Column<double>(type: "double precision", nullable: true),
                    latitude = table.Column<double>(type: "double precision", nullable: true),
                    location = table.Column<Point>(type: "geometry(Point,4326)", nullable: true),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    reported_by = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    cancellation_reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    version = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_network_incidents", x => x.id);
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

            migrationBuilder.CreateTable(
                name: "incident_affected_assets",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    incident_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    asset_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    kind = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    verified = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_incident_affected_assets", x => x.id);
                    table.ForeignKey(
                        name: "FK_incident_affected_assets_network_incidents_incident_id",
                        column: x => x.incident_id,
                        principalTable: "network_incidents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "incident_timeline_entries",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    incident_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    entry_type = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    actor_id = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    occurred_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    sequence = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_incident_timeline_entries", x => x.id);
                    table.ForeignKey(
                        name: "FK_incident_timeline_entries_network_incidents_incident_id",
                        column: x => x.incident_id,
                        principalTable: "network_incidents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_idempotency_entries_ProcessedAt",
                table: "idempotency_entries",
                column: "ProcessedAt");

            migrationBuilder.CreateIndex(
                name: "ix_affected_assets_tenant_incident",
                table: "incident_affected_assets",
                columns: new[] { "tenant_id", "incident_id" });

            migrationBuilder.CreateIndex(
                name: "IX_incident_affected_assets_incident_id",
                table: "incident_affected_assets",
                column: "incident_id");

            migrationBuilder.CreateIndex(
                name: "IX_incident_timeline_entries_incident_id",
                table: "incident_timeline_entries",
                column: "incident_id");

            migrationBuilder.CreateIndex(
                name: "ix_timeline_tenant_incident",
                table: "incident_timeline_entries",
                columns: new[] { "tenant_id", "incident_id" });

            migrationBuilder.CreateIndex(
                name: "ix_incidents_tenant_severity",
                table: "network_incidents",
                columns: new[] { "tenant_id", "severity" });

            migrationBuilder.CreateIndex(
                name: "ix_incidents_tenant_status",
                table: "network_incidents",
                columns: new[] { "tenant_id", "status" });

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
                name: "incident_affected_assets");

            migrationBuilder.DropTable(
                name: "incident_timeline_entries");

            migrationBuilder.DropTable(
                name: "outbox_entries");

            migrationBuilder.DropTable(
                name: "processed_events");

            migrationBuilder.DropTable(
                name: "network_incidents");
        }
    }
}
