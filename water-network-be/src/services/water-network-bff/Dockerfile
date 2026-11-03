FROM mcr.microsoft.com/dotnet/sdk:10.0.302 AS build
WORKDIR /repo
COPY global.json Directory.Build.props Directory.Packages.props ./
COPY src/ src/
RUN dotnet publish src/services/water-network-bff/src/WaterNetwork.Bff.Api -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0.10 AS runtime
WORKDIR /app
COPY --from=build /app .
EXPOSE 8080
ENV ASPNETCORE_URLS=http://+:8080
ENTRYPOINT ["dotnet", "WaterNetwork.Bff.Api.dll"]
