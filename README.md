# Prisoner's Dilemma

An admin creates a "dilemma" room and shares a short, unguessable link.
Everyone who opens the link picks **stay silent** or **snitch** under a
randomly assigned gangster alias. The admin dashboard updates live as votes
land.

- Node 22 · Express · EJS · SQLite (`better-sqlite3`) · Server-Sent Events
- One vote per browser, one alias per round
- No build step, no frontend framework, no external services

---

## Quick start

```bash
npm install
ADMIN_PASSWORD=devpass npm run dev
```

Open <http://localhost:3000/admin> and sign in as `admin` / `devpass`.

If you leave `ADMIN_PASSWORD` unset, a password is generated and printed
**once** on first boot — look for `ADMIN ACCOUNT CREATED` in the output.

> `docker-compose.yml` is written for the **server**: it pulls a published
> image, publishes no ports, and joins Traefik's external network. It will not
> come up on a laptop unchanged. Use `npm run dev` locally, or see
> [Running the container locally](#running-the-container-locally).

---

## Development

```bash
npm install
npm run dev          # node --watch, restarts on change
```

Runs on <http://localhost:3000> with the database at `./data/dilemma.sqlite`.

Useful overrides:

```bash
PORT=4000 DATA_DIR=./tmp ADMIN_PASSWORD=devpass npm run dev
```

To start over from a clean slate, delete the data directory and restart —
the schema and admin account are recreated automatically.

### Running the container locally

To exercise the actual image without Traefik:

```bash
docker build -t prisoners-dilemma:dev .
docker run --rm -p 3000:3000 -e ADMIN_PASSWORD=devpass prisoners-dilemma:dev
```

---

## How it works

**Admin** (`/admin`) — create a dilemma, share the link or QR code, watch
results stream in. You can close voting, reset votes, export a CSV, or delete
the room.

**Closing the voting resolves the card.** Participants see nothing at all
while a round is running — no running totals, so nobody can time their choice
against how others are voting. The moment you close it, everyone is shown the
verdict, the final split, and the damage they personally took.

**Participant** (`/d/<slug>`) — sees the briefing, an alias prefilled from a
pool of ~240 pop-culture gangsters (editable, or reroll with ↻), and the two
choices. After confirming, the page locks and shows their decision.

**One vote per person** is enforced by a signed, http-only cookie plus a
unique index on `(dilemma_id, voter_token)`. A second unique index on
`(dilemma_id, name_key)` guarantees no two people share an alias — names are
normalised, so `Tony Montana` and `  tony   MONTANA ` collide as intended.

> This stops casual double voting. It does **not** stop someone who clears
> cookies or opens a private window — appropriate for a workshop or party
> game, not for anything binding. The admin's alias list makes duplicates
> visible anyway.

Slugs are 8 characters from a 30-character alphabet with look-alikes
(`0/O`, `1/l/I`) removed: ~6.5 × 10¹¹ combinations, short enough to type off
a slide, and rate limited at 60 requests/minute against enumeration.

---

## Releasing

`scripts/release.sh` builds the image, pushes it to GHCR, pins the version in
`docker-compose.yml`, then commits and tags.

```bash
./scripts/release.sh 1.2.3            # full release
./scripts/release.sh 1.2.3 --dry-run  # build only, no push/commit/tag
```

It refuses to run on a dirty tree, if the git tag exists, or if that image tag
is already published — released versions stay immutable.

**Credentials.** Pushing needs `write:packages`, which `gh auth login` does not
grant by default. Either:

```bash
export GHCR_TOKEN=ghp_...                       # classic PAT with write:packages
gh auth refresh --scopes write:packages,read:packages   # or extend the gh token
```

`GHCR_TOKEN` takes precedence when set.

**Cross-compiling.** The image is always built for `linux/amd64`, so releasing
from an Apple Silicon Mac produces something the server can actually run. This
uses a `docker-container` buildx builder, created automatically on first use.

## Production deployment

The server needs only two files — `docker-compose.yml` and `.env`. There is no
source checkout and nothing is built there.

```bash
mkdir -p ~/prisoners-dilemma && cd ~/prisoners-dilemma
curl -O https://raw.githubusercontent.com/zlorfi/prisoners-dilemma/main/docker-compose.yml
curl -o .env https://raw.githubusercontent.com/zlorfi/prisoners-dilemma/main/.env.example
```

### 1. Configure

Edit `.env`:

| Variable | Set it to |
| --- | --- |
| `ADMIN_USERNAME` | your admin login |
| `ADMIN_PASSWORD` | a strong password, **or** leave blank to auto-generate |
| `SESSION_SECRET` | `openssl rand -hex 32` — pin this, don't let it drift |
| `PUBLIC_ORIGIN` | `https://dilemma.example.com` (used for links and QR codes) |
| `TRUST_PROXY` | `1` when behind nginx / Traefik / Caddy |
| `COOKIE_SECURE` | `1` — required once you're on HTTPS |
| `HOST_PORT` | host port to publish, defaults to `3000` |

`SESSION_SECRET` signs both admin sessions and voter cookies. If it changes,
everyone is logged out **and** voter cookies stop verifying, which lets people
vote a second time. Set it explicitly in production. (If you don't, one is
generated and persisted in the volume, which is fine as long as the volume
survives.)

### 2. Run

```bash
docker compose pull
docker compose up -d
docker compose logs -f app
```

The container runs as the unprivileged `node` user with
`no-new-privileges`, and ships a healthcheck on `/healthz`.

### 3. Put TLS in front

The app speaks plain HTTP and expects a reverse proxy to terminate TLS.
SSE needs buffering off — the app sends `X-Accel-Buffering: no`, but set it
explicitly if your proxy ignores that:

```nginx
server {
    server_name dilemma.example.com;
    listen 443 ssl http2;
    # ssl_certificate ... (certbot or similar)

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # keep the live results flowing
        proxy_buffering    off;
        proxy_cache        off;
        proxy_read_timeout 1h;
    }
}
```

With TLS live, make sure `COOKIE_SECURE=1` and `TRUST_PROXY=1` are set,
then `docker compose up -d` to apply.

### Backups

Everything lives in the `dilemma-data` volume.

```bash
# back up
docker compose exec app node -e \
  "require('better-sqlite3')('/data/dilemma.sqlite').backup('/data/backup.sqlite').then(()=>console.log('ok'))" \
  && docker compose cp app:/data/backup.sqlite ./backup.sqlite

# restore
docker compose cp ./backup.sqlite app:/data/dilemma.sqlite && docker compose restart app
```

Use the online `.backup` above rather than copying the file directly — the
database runs in WAL mode, so a raw copy can be inconsistent.

### Upgrading

Release a new version from your workstation (`./scripts/release.sh 1.2.3`),
then on the server pull the updated compose file and restart:

```bash
cd ~/prisoners-dilemma
curl -O https://raw.githubusercontent.com/zlorfi/prisoners-dilemma/v1.2.3/docker-compose.yml
docker compose pull && docker compose up -d
```

The schema is created with `CREATE TABLE IF NOT EXISTS` on boot; the data
volume is untouched by an upgrade.

To roll back, fetch the compose file from an earlier tag and repeat — old
image tags stay in GHCR.

---

## Notes

- **Scaling**: state is a single SQLite file and the SSE bus is in-process, so
  run exactly one container. That comfortably handles a room full of people.
  Multiple replicas would need Redis pub/sub and a shared database.
- **Changing the alias pool**: edit `src/lib/names.js`. Duplicates are removed
  automatically on load.
- **Rate limits**: login 10 / 15 min, votes 15 / min, page loads 60 / min,
  all per IP. Set `TRUST_PROXY=1` or every request looks like it comes from
  the proxy.
