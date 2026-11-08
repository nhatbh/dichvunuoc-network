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
                name: "network_asset_states",
                columns: table => new
                {
                    asset_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    lifecycle_status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    updated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    last_event_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_network_asset_states", x => x.asset_id);
                });

            migrationBuilder.CreateTable(
                name: "network_devices",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    asset_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    component_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    properties = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
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

            migrationBuilder.CreateTable(
                name: "network_edit_batches",
                columns: table => new
                {
                    revision_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    completed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_network_edit_batches", x => new { x.tenant_id, x.revision_id });
                });

            migrationBuilder.CreateTable(
                name: "network_nodes",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    asset_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    component_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    properties = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
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
                    component_code = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    properties = table.Column<string>(type: "jsonb", nullable: false, defaultValueSql: "'{}'::jsonb"),
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

            migrationBuilder.CreateTable(
                name: "outbox_entries",
                columns: table => new
                {
                    Id = table.Column<string>(type: "text", nullable: false),
                    AggregateId = table.Column<string>(type: "text", nullable: false),
                    AggregateType = table.Column<string>(type: "text", nullable: false),
                    EventType = table.Column<string>(type: "text", nullable: false),
                    EventVersion = table.Column<int>(type: "integer", nullable: false),
                    TenantId = table.Column<string>(type: "text", nullable: true),
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
                name: "ux_geometry_versions_asset_version",
                table: "geometry_versions",
                columns: new[] { "asset_id", "version" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ux_gis_import_ledger_revision_draft",
                table: "gis_import_ledger",
                columns: new[] { "revision_id", "draft_asset_id" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_idempotency_entries_ProcessedAt",
                table: "idempotency_entries",
                column: "ProcessedAt");

            migrationBuilder.CreateIndex(
                name: "ix_asset_states_tenant",
                table: "network_asset_states",
                column: "tenant_id");

            migrationBuilder.CreateIndex(
                name: "ix_network_devices_host_node",
                table: "network_devices",
                columns: new[] { "tenant_id", "host_node_id" },
                filter: "host_node_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_network_devices_host_pipe",
                table: "network_devices",
                columns: new[] { "tenant_id", "host_pipe_id" },
                filter: "host_pipe_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "ix_network_devices_location_gist",
                table: "network_devices",
                column: "location")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "ix_network_devices_tenant_component",
                table: "network_devices",
                columns: new[] { "tenant_id", "component_code" });

            migrationBuilder.CreateIndex(
                name: "ux_network_devices_tenant_asset_code",
                table: "network_devices",
                columns: new[] { "tenant_id", "asset_code" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_network_nodes_location_gist",
                table: "network_nodes",
                column: "location")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "ix_network_nodes_tenant_component",
                table: "network_nodes",
                columns: new[] { "tenant_id", "component_code" });

            migrationBuilder.CreateIndex(
                name: "ux_network_nodes_tenant_asset_code",
                table: "network_nodes",
                columns: new[] { "tenant_id", "asset_code" },
                unique: true);

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
                name: "ix_network_pipes_tenant_component",
                table: "network_pipes",
                columns: new[] { "tenant_id", "component_code" });

            migrationBuilder.CreateIndex(
                name: "ux_network_pipes_tenant_asset_code",
                table: "network_pipes",
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
                name: "geometry_versions");

            migrationBuilder.DropTable(
                name: "gis_import_ledger");

            migrationBuilder.DropTable(
                name: "idempotency_entries");

            migrationBuilder.DropTable(
                name: "network_asset_states");

            migrationBuilder.DropTable(
                name: "network_devices");

            migrationBuilder.DropTable(
                name: "network_edit_batches");

            migrationBuilder.DropTable(
                name: "network_nodes");

            migrationBuilder.DropTable(
                name: "network_pipes");

            migrationBuilder.DropTable(
                name: "outbox_entries");

            migrationBuilder.DropTable(
                name: "processed_events");
        }
    }
}
