FROM python:3.11-slim
# git + docker CLI to drive deploys. docker.io ships the CLI + buildx but NOT
# the Compose v2 plugin, and the controller runs `docker compose ... up --build`
# — so pull the compose plugin binary in explicitly, else every deploy exits 125
# ("'compose' is not a docker command"). Pinned to match the host daemon's v2.
ARG COMPOSE_VERSION=v2.32.3
RUN apt-get update && apt-get install -y --no-install-recommends git docker.io curl ca-certificates && \
    mkdir -p /usr/libexec/docker/cli-plugins && \
    curl -fsSL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" \
      -o /usr/libexec/docker/cli-plugins/docker-compose && \
    chmod +x /usr/libexec/docker/cli-plugins/docker-compose && \
    apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8090
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8090"]
