# Build from repo root:
#   docker build --platform linux/amd64 \
#     -f water-network/water-network-fe/water-network-gis-bff/Dockerfile \
#     -t water-network-gis-bff .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY Directory.Build.props Directory.Packages.props global.json ./
# Restore as a separate layer for faster rebuilds (only re-runs when .csproj changes)
COPY water-network/water-network-fe/water-network-gis-bff/WaterNetwork.GisBff/WaterNetwork.GisBff.csproj \
     water-network/water-network-fe/water-network-gis-bff/WaterNetwork.GisBff/
RUN dotnet restore water-network/water-network-fe/water-network-gis-bff/WaterNetwork.GisBff/WaterNetwork.GisBff.csproj
COPY water-network/water-network-fe/water-network-gis-bff/ water-network/water-network-fe/water-network-gis-bff/
RUN dotnet publish \
      water-network/water-network-fe/water-network-gis-bff/WaterNetwork.GisBff/WaterNetwork.GisBff.csproj \
      -c Release -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
# seed/gis-seed.json is included via csproj Content + CopyToOutputDirectory — no manual COPY needed
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "WaterNetwork.GisBff.dll"]
