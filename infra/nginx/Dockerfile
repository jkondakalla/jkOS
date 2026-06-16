FROM nginx:alpine

# Reverse proxy for all *.jkos.net services. nginx.conf and the SSL certs are
# bind-mounted at runtime (see docker-compose.yml), so this image is just stock
# nginx — `build: .` is kept so `docker compose up --build` has a target and so
# future baked-in assets have a home. The staging root is now the real ORDECK
# shell (staging-ordeck-shell), so the former static landing page is gone.
