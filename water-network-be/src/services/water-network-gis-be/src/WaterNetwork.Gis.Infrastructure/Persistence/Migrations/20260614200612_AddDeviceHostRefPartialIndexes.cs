using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WaterNetwork.Gis.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDeviceHostRefPartialIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_network_devices_host_node",
                table: "network_devices");

            migrationBuilder.DropIndex(
                name: "ix_network_devices_host_pipe",
                table: "network_devices");

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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_network_devices_host_node",
                table: "network_devices");

            migrationBuilder.DropIndex(
                name: "ix_network_devices_host_pipe",
                table: "network_devices");

            migrationBuilder.CreateIndex(
                name: "ix_network_devices_host_node",
                table: "network_devices",
                columns: new[] { "tenant_id", "host_node_id" });

            migrationBuilder.CreateIndex(
                name: "ix_network_devices_host_pipe",
                table: "network_devices",
                columns: new[] { "tenant_id", "host_pipe_id" });
        }
    }
}
