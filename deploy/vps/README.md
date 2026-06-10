# VPS deployment (ott.wotanii.de)

Runs the prebuilt `dyc3/opentogethertube` image with redis and postgres via
docker compose. The app listens on `127.0.0.1:8123` (HTTP) on the host; the
host's nginx terminates TLS for `https://ott.wotanii.de` and reverse-proxies
to that port.

## Setup

```bash
# 1. copy this directory to the VPS
mkdir -p /srv/opentogethertube
cp -r deploy/vps/* deploy/vps/.env.example /srv/opentogethertube/
cd /srv/opentogethertube

# 2. set a postgres password
cp .env.example .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env

# 3. fill in secrets in env/production.toml
#    api_key:        openssl rand -hex 32
#    session_secret: openssl rand -hex 64
#    optionally a youtube api key
$EDITOR env/production.toml

# 4. start
docker compose up -d

# 5. verify it answers on plain http
curl http://127.0.0.1:8123/api/status
```

## nginx (after step 5 works)

```bash
cp nginx-ott.wotanii.de.conf /etc/nginx/sites-available/ott.wotanii.de
ln -s /etc/nginx/sites-available/ott.wotanii.de /etc/nginx/sites-enabled/
# adjust ssl_certificate paths if you don't use certbot defaults
nginx -t && systemctl reload nginx
```

Then open https://ott.wotanii.de.

## Notes

-   The websocket proxy headers in the nginx config are required — without
    them rooms will load but never sync.
-   To change the host port, edit the `ports:` mapping in
    `docker-compose.yml` and the `proxy_pass` in the nginx config.
-   Update: `docker compose pull && docker compose up -d`
-   Logs: `docker compose logs -f opentogethertube`
-   Data lives in the named volumes `db-data-redis` and `db-data-postgres`.
