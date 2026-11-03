# gis-3d image — built from the water-network-fe/ context (NOT apps/gis-3d/),
# because the app consumes two file: workspace packages that live OUTSIDE its own
# directory: @wn/contracts, @wn/map-runtime and @wn/map-runtime-3d at ../../packages/*. There are no
# npm workspaces here, and each package's dist/ is gitignored, so every package is
# installed and built in dependency order before the app consumes its dist.
#
#   build (from water-network-fe/):
#     docker build -f apps/gis-3d/Dockerfile -t water-network-gis-3d .
#
# Stage 1: Build
# Node 22 is the supported LTS line for this release. Pin the multi-platform
# manifest digest so rebuilds cannot silently pick up a different toolchain.
FROM node:22.23.1-alpine3.24@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS builder

WORKDIR /app

# Skip husky git-hook install — there is no .git in the build context.
ENV HUSKY=0

# Production auth posture is baked at build (the bundle freezes import.meta.env.*).
# Per-environment endpoints arrive at runtime via /config.json (see ConfigMap).
# IMPORTANT: VITE_KEYCLOAK_ON_LOAD must be login-required (NOT check-sso) — check-sso
# opens a silent iframe that conflicts with MSW service-worker + KC frame-ancestors CSP
# and leaves the app stuck in an anonymous state on first load.
ARG VITE_AUTH_MODE=keycloak
ARG VITE_ENABLE_MSW=false
ARG VITE_USE_MOCK_AUTH=false
ARG VITE_USE_RUNTIME_CONFIG=true
ARG VITE_KEYCLOAK_ON_LOAD=login-required
ARG VITE_USE_MOCK_DATA=false
# Keycloak connection — baked at build so SSO init never races the async /config.json
# fetch. config.json (via ConfigMap) stays as the runtime override for URL/realm/client.
ARG VITE_KEYCLOAK_URL=https://auth-dev.dichvunuoc.vn
ARG VITE_KEYCLOAK_REALM=water-platform
ARG VITE_KEYCLOAK_CLIENT_ID=water-network-gis-fe
ARG VITE_API_URL=https://api-dev.dichvunuoc.vn/api/gis
ARG VITE_MENU_APP_URL=https://apps-dev.dichvunuoc.vn
ENV VITE_AUTH_MODE=$VITE_AUTH_MODE \
    VITE_ENABLE_MSW=$VITE_ENABLE_MSW \
    VITE_USE_MOCK_AUTH=$VITE_USE_MOCK_AUTH \
    VITE_USE_RUNTIME_CONFIG=$VITE_USE_RUNTIME_CONFIG \
    VITE_KEYCLOAK_ON_LOAD=$VITE_KEYCLOAK_ON_LOAD \
    VITE_USE_MOCK_DATA=$VITE_USE_MOCK_DATA \
    VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID \
    VITE_API_URL=$VITE_API_URL \
    VITE_MENU_APP_URL=$VITE_MENU_APP_URL

# 1) @wn/contracts — leaf package, no internal deps. Install deps from the lockfile
#    first (cache layer), then copy source and emit dist.
COPY packages/contracts/package.json packages/contracts/package-lock.json packages/contracts/
RUN npm --prefix packages/contracts ci
COPY packages/contracts packages/contracts
RUN npm --prefix packages/contracts run build

# 2) @wn/map-runtime — depends on @wn/contracts (file:../contracts, now present + built).
COPY packages/map-runtime/package.json packages/map-runtime/package-lock.json packages/map-runtime/
RUN npm --prefix packages/map-runtime ci
COPY packages/map-runtime packages/map-runtime
RUN npm --prefix packages/map-runtime run build

# 3) @wn/map-runtime-3d — MapLibre + deck.gl engine; depends on @wn/contracts and the
#    2D @wn/map-runtime (types + geometry helpers it re-exports), both built above.
COPY packages/map-runtime-3d/package.json packages/map-runtime-3d/package-lock.json packages/map-runtime-3d/
RUN npm --prefix packages/map-runtime-3d ci
COPY packages/map-runtime-3d packages/map-runtime-3d
RUN npm --prefix packages/map-runtime-3d run build

# 4) gis-3d app — its file: deps resolve to ../../packages/* (present + built above).
COPY apps/gis-3d/package.json apps/gis-3d/package-lock.json apps/gis-3d/
RUN npm --prefix apps/gis-3d ci
COPY apps/gis-3d apps/gis-3d
RUN npm --prefix apps/gis-3d run build

# Stage 2: Serve with nginx (unprivileged: listens on 8080, runs as uid 101)
# Pin the runtime manifest as well; promotion scans this exact image content.
FROM nginxinc/nginx-unprivileged:1.31.3-alpine@sha256:a718212f9cf21e241f14067333000a3f0930292f5354fe0db269e9a2a2596b9e

COPY --from=builder /app/apps/gis-3d/dist /usr/share/nginx/html
COPY apps/gis-3d/nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080
