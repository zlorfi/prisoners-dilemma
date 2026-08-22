#!/usr/bin/env bash
#
# Build the app, push it to GitHub Container Registry, pin the new version in
# docker-compose.yml, then commit and tag the result.
#
#   ./scripts/release.sh 1.2.3
#   ./scripts/release.sh 1.2.3 --dry-run
#
# On the server you only ever need docker-compose.yml and a .env:
#
#   docker compose pull && docker compose up -d
#
set -euo pipefail

REPO="zlorfi/prisoners-dilemma"
IMAGE="ghcr.io/${REPO}"

# The server is x86; this machine may well be Apple Silicon, so the platform
# is pinned explicitly rather than inherited from the host.
PLATFORMS="linux/amd64"

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# --- pretty output ----------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BOLD=''; RED=''; GREEN=''; YELLOW=''; DIM=''; RESET=''
fi

step() { printf '%s==>%s %s\n' "$BOLD" "$RESET" "$1"; }
info() { printf '    %s\n' "$1"; }
warn() { printf '%s !  %s%s\n' "$YELLOW" "$1" "$RESET"; }
ok()   { printf '%s ok %s%s\n' "$GREEN" "$1" "$RESET"; }
die()  { printf '%serror:%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }

# --- arguments --------------------------------------------------------------

VERSION="${1:-}"
DRY_RUN=0
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

if [ -z "$VERSION" ]; then
  cat <<EOF
usage: $0 <version> [--dry-run]

  <version>   semver without a leading v, e.g. 1.2.3
  --dry-run   build but do not push, commit or tag

Latest tags:
$(git tag -l 'v*' --sort=-v:refname | head -5 | sed 's/^/  /' || echo '  (none yet)')
EOF
  exit 1
fi

# Accept 1.2.3 and 1.2.3-rc1, reject a leading "v" so the tag format stays
# predictable (the git tag gets the v, the image tag does not).
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  die "version must look like 1.2.3 or 1.2.3-rc1 (no leading 'v'), got: $VERSION"
fi

TAG="v${VERSION}"

# --- preflight --------------------------------------------------------------

step "Checking prerequisites"

command -v docker >/dev/null || die "docker not found"
docker buildx version >/dev/null 2>&1 || die "docker buildx not available"
docker info >/dev/null 2>&1 || die "docker daemon not running"
command -v git >/dev/null || die "git not found"
ok "docker and git present"

if [ -n "$(git status --porcelain)" ]; then
  git status --short | sed 's/^/    /'
  die "working tree is dirty - commit or stash first"
fi
ok "working tree clean"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  die "tag $TAG already exists (use a new version, or: git tag -d $TAG)"
fi

# Refuse to overwrite a published image. Tags are supposed to be immutable;
# silently replacing one makes "which build is running?" unanswerable later.
if docker manifest inspect "${IMAGE}:${VERSION}" >/dev/null 2>&1; then
  die "${IMAGE}:${VERSION} already exists in the registry - bump the version"
fi
ok "version $VERSION is unused"

# --- registry login ---------------------------------------------------------

step "Authenticating to ghcr.io"

if [ -n "${GHCR_TOKEN:-}" ]; then
  TOKEN="$GHCR_TOKEN"
  TOKEN_SOURCE="\$GHCR_TOKEN"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  TOKEN="$(gh auth token)"
  TOKEN_SOURCE="gh auth token"

  # Pushing needs write:packages. The default gh login scopes do NOT include
  # it, and the failure otherwise surfaces as a confusing 403 denied at the
  # very end of the push, after the whole build has run.
  if ! gh auth status 2>&1 | grep -q 'write:packages'; then
    warn "your gh token is missing the 'write:packages' scope"
    info "grant it with:"
    info "  gh auth refresh --scopes write:packages,read:packages,delete:packages"
    info "or export a classic PAT that has it:"
    info "  export GHCR_TOKEN=ghp_..."
    die "cannot push to ghcr.io without write:packages"
  fi
else
  die "no credentials: set GHCR_TOKEN, or run 'gh auth login'"
fi

GH_USER="$(echo "$REPO" | cut -d/ -f1)"
if ! echo "$TOKEN" | docker login ghcr.io -u "$GH_USER" --password-stdin >/dev/null 2>&1; then
  die "docker login to ghcr.io failed (token from $TOKEN_SOURCE)"
fi
ok "logged in as $GH_USER (via $TOKEN_SOURCE)"

# --- build and push ---------------------------------------------------------

step "Building ${IMAGE}:${VERSION} for ${PLATFORMS}"

# A container driver is required for cross-platform builds; the default
# "docker" driver can only produce images for the host architecture.
BUILDER="prisoners-dilemma-builder"
if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  info "creating buildx builder '$BUILDER'"
  docker buildx create --name "$BUILDER" --driver docker-container >/dev/null
fi

BUILD_ARGS=(
  --builder "$BUILDER"
  --platform "$PLATFORMS"
  --tag "${IMAGE}:${VERSION}"
  --tag "${IMAGE}:latest"
  --label "org.opencontainers.image.source=https://github.com/${REPO}"
  --label "org.opencontainers.image.version=${VERSION}"
  --label "org.opencontainers.image.revision=$(git rev-parse HEAD)"
  --label "org.opencontainers.image.created=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  --label "org.opencontainers.image.licenses=MIT"
  --label "org.opencontainers.image.title=Prisoner's Dilemma"
  # Layer cache lives in the registry, so a rebuild from a clean checkout
  # (or another machine) still skips the slow native-module compile.
  --cache-from "type=registry,ref=${IMAGE}:buildcache"
)

if [ "$DRY_RUN" -eq 1 ]; then
  warn "dry run: building without pushing"
  docker buildx build "${BUILD_ARGS[@]}" .
  ok "build succeeded"
  step "Dry run complete - nothing pushed, committed or tagged"
  exit 0
fi

docker buildx build "${BUILD_ARGS[@]}" \
  --cache-to "type=registry,ref=${IMAGE}:buildcache,mode=max" \
  --push .
ok "pushed ${IMAGE}:${VERSION} and :latest"

DIGEST="$(docker buildx imagetools inspect "${IMAGE}:${VERSION}" \
  --format '{{.Manifest.Digest}}' 2>/dev/null || echo 'unknown')"
info "digest: $DIGEST"

# --- pin the version in docker-compose.yml ----------------------------------

step "Pinning $VERSION in docker-compose.yml"

[ -f docker-compose.yml ] || die "docker-compose.yml not found"

# Only the image line changes; everything else in the file is left alone.
# BSD and GNU sed disagree about -i, so write to a temp file and move it.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
sed -E "s|^([[:space:]]*image:[[:space:]]*).*$|\1${IMAGE}:${VERSION}|" \
  docker-compose.yml > "$TMP"

if ! grep -q "${IMAGE}:${VERSION}" "$TMP"; then
  die "failed to rewrite the image line in docker-compose.yml"
fi
mv "$TMP" docker-compose.yml
trap - EXIT

docker compose config >/dev/null 2>&1 || die "resulting docker-compose.yml is invalid"
ok "image: ${IMAGE}:${VERSION}"

# --- commit and tag ---------------------------------------------------------

step "Committing and tagging"

# package.json is the source of truth for the version; keep it in step.
if command -v npm >/dev/null 2>&1; then
  npm pkg set version="$VERSION" >/dev/null
  git add package.json
fi

git add docker-compose.yml
git commit -q -m "Release ${TAG}" -m "Image: ${IMAGE}:${VERSION}"
git tag -a "$TAG" -m "Release ${TAG}"
ok "committed and tagged $TAG"

step "Pushing to origin"
git push -q origin HEAD
git push -q origin "$TAG"
ok "pushed main and $TAG"

# --- done -------------------------------------------------------------------

cat <<EOF

${GREEN}${BOLD}Released ${TAG}${RESET}

  image   ${IMAGE}:${VERSION}
  digest  ${DIGEST}

${BOLD}Deploy on the server:${RESET}
${DIM}  # first time only${RESET}
  mkdir -p ~/prisoners-dilemma && cd ~/prisoners-dilemma
  curl -O https://raw.githubusercontent.com/${REPO}/${TAG}/docker-compose.yml
  curl -o .env https://raw.githubusercontent.com/${REPO}/${TAG}/.env.example
  \$EDITOR .env      ${DIM}# set SESSION_SECRET and ADMIN_PASSWORD${RESET}

${DIM}  # every release${RESET}
  cd ~/prisoners-dilemma
  curl -O https://raw.githubusercontent.com/${REPO}/${TAG}/docker-compose.yml
  docker compose pull && docker compose up -d

EOF
