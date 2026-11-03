using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WaterNetwork.Asset.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddLifecycleAndTechnicalProfile : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "decommission_reason",
                table: "network_assets",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "decommissioned_by",
                table: "network_assets",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "asset_technical_profiles",
                columns: table => new
                {
                    asset_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    installation_year = table.Column<int>(type: "integer", nullable: true),
                    manufacturer = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    model = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    attributes = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_asset_technical_profiles", x => x.asset_id);
                    table.ForeignKey(
                        name: "FK_asset_technical_profiles_network_assets_asset_id",
                        column: x => x.asset_id,
                        principalTable: "network_assets",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "asset_technical_profiles");

            migrationBuilder.DropColumn(
                name: "decommission_reason",
                table: "network_assets");

            migrationBuilder.DropColumn(
                name: "decommissioned_by",
                table: "network_assets");
        }
    }
}
