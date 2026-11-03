# Build the binary against the workspace at the service directory.
FROM rust:1.92.0-slim-bookworm AS build
WORKDIR /build
COPY src/services/water-network-topology-rs/ ./
RUN cargo build --release -p topology-service

FROM debian:bookworm-slim AS runtime
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /build/target/release/topology-service /usr/local/bin/topology-service
RUN mkdir -p /app/data
EXPOSE 8080
ENV TOPOLOGY_HTTP_BIND=0.0.0.0:8080
EXPOSE 50051
ENV TOPOLOGY_GRPC_BIND=0.0.0.0:50051
ENTRYPOINT ["topology-service"]
