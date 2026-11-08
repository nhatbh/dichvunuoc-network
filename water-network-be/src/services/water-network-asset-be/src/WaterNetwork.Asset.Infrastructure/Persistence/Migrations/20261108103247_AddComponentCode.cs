using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WaterNetwork.Asset.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddComponentCode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "component_code",
                table: "network_assets",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "ix_network_assets_tenant_component",
                table: "network_assets",
                columns: new[] { "tenant_id", "component_code" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "ix_network_assets_tenant_component",
                table: "network_assets");

            migrationBuilder.DropColumn(
                name: "component_code",
                table: "network_assets");
        }
    }
}
