using System;
using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WaterNetwork.Incident.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddIsolationPlans : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "isolation_plans",
                columns: table => new
                {
                    id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    incident_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    tenant_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    start_node_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    graph_version = table.Column<long>(type: "bigint", nullable: false),
                    valves_to_close = table.Column<List<string>>(type: "text[]", nullable: false),
                    isolated_nodes = table.Column<List<string>>(type: "text[]", nullable: false),
                    isolated_pipes = table.Column<List<string>>(type: "text[]", nullable: false),
                    failure_reason = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    computed_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    sequence = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_isolation_plans", x => x.id);
                    table.ForeignKey(
                        name: "FK_isolation_plans_network_incidents_incident_id",
                        column: x => x.incident_id,
                        principalTable: "network_incidents",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_isolation_plans_incident_id",
                table: "isolation_plans",
                column: "incident_id");

            migrationBuilder.CreateIndex(
                name: "ix_isolation_plans_tenant_incident",
                table: "isolation_plans",
                columns: new[] { "tenant_id", "incident_id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "isolation_plans");
        }
    }
}
