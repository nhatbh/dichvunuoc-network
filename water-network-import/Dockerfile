FROM python:3.11.15-slim-bookworm@sha256:d29f48a31a8b408ed19272ca1e7b10ebae13b240a27e862d3d4217c528e2e0c3 AS converter
RUN apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config curl ca-certificates zlib1g-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSL --connect-timeout 20 --max-time 180 --retry 3 https://ftp.gnu.org/gnu/libredwg/libredwg-0.14.tar.gz -o libredwg.tar.gz \
    && echo 'cb6ee0b078c6d9e0f09d66f1feac33ba6342df88ae544e9f9335fab475218351  libredwg.tar.gz' | sha256sum -c - \
    && tar xzf libredwg.tar.gz \
    && cd libredwg-0.14 \
    && CFLAGS="-O1 -g0" ./configure --disable-shared --enable-static --disable-bindings --disable-docs --disable-write --disable-json \
    && make -j1 \
    && make install

FROM python:3.11.15-slim-bookworm@sha256:d29f48a31a8b408ed19272ca1e7b10ebae13b240a27e862d3d4217c528e2e0c3 AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 IMPORT_DATA_DIR=/data PROJ_NETWORK=OFF XDG_CACHE_HOME=/tmp/.cache
RUN groupadd -g 10001 importer && useradd -u 10001 -g importer -m importer && mkdir /app /data && chown importer:importer /app /data
COPY --from=converter /usr/local/bin/dwg2dxf /usr/local/bin/dwg2dxf
# LibreDWG corresponding source and license are shipped with the converter image.
COPY --from=converter /build/libredwg.tar.gz /usr/share/doc/libredwg/source.tar.gz
COPY --from=converter /build/libredwg-0.14/COPYING /usr/share/doc/libredwg/COPYING
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir --no-deps . && dwg2dxf --version
USER 10001:10001
EXPOSE 8090
CMD ["uvicorn", "wn_import.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8090", "--workers", "1", "--limit-concurrency", "32", "--timeout-keep-alive", "5"]
