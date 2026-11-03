using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace WaterNetwork.Asset.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddOutboxTenantId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TenantId",
                table: "outbox_entries",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TenantId",
                table: "outbox_entries");
        }
    }
}
