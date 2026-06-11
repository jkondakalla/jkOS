FROM nginx:alpine

# Landing page is COPYd in so it's root-owned and readable by nginx workers.
# TrueNAS ZFS POSIX_RESTRICTED ACLs prevent chmod/setfacl from the CLI, so
# bind-mounting host files with mode 770 leaves workers unable to read them.
# Rebuild this image (docker compose up -d --build) after editing staging-static/.
COPY staging-static/ /etc/nginx/staging-html/
RUN chmod -R 755 /etc/nginx/staging-html
