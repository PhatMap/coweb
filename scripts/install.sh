#!/bin/sh
set -eu

REPOSITORY="${COWEB_RELEASE_REPOSITORY:?CoWeb release downloads are unconfigured; set COWEB_RELEASE_REPOSITORY explicitly}"
VERSION="${COWEB_RELEASE_VERSION:-5.0.6}"
BIN_DIR="${COWEB_BIN_DIR:-$HOME/.local/bin}"
LIB_DIR="${COWEB_LIB_DIR:-$HOME/.local/lib/coweb}"
DOC_DIR="${COWEB_DOC_DIR:-$HOME/.local/share/doc/coweb}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "The terminal-only installer supports macOS only; use the desktop launcher on Windows or Linux" >&2
  exit 1
fi

case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="amd64" ;;
  *) echo "Unsupported macOS architecture: $(uname -m)" >&2; exit 1 ;;
esac

ASSET="coweb-darwin-$ARCH.tar.gz"
BASE_URL="https://github.com/$REPOSITORY/releases/download/v$VERSION"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/coweb.XXXXXX")"
STAGE_DIR="$LIB_DIR/.stage-$VERSION-$$"
TARGET_DIR="$LIB_DIR/$VERSION"
BACKUP_DIR="$LIB_DIR/.previous-$VERSION-$$"
trap 'rm -rf "$TEMP_DIR" "$STAGE_DIR"' EXIT HUP INT TERM

curl -fsSL "$BASE_URL/$ASSET" -o "$TEMP_DIR/$ASSET"
curl -fsSL "$BASE_URL/checksums.txt" -o "$TEMP_DIR/checksums.txt"

EXPECTED="$(awk -v asset="$ASSET" '$2 == asset { print $1 }' "$TEMP_DIR/checksums.txt")"
ACTUAL="$(shasum -a 256 "$TEMP_DIR/$ASSET" | awk '{ print $1 }')"
if [ -z "$EXPECTED" ] || [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "SHA-256 verification failed for $ASSET" >&2
  exit 1
fi

for DOC in LICENSE Bun-1.4.0.md THIRD_PARTY_NOTICES.txt; do
  curl -fsSL "$BASE_URL/$DOC" -o "$TEMP_DIR/$DOC"
  DOC_EXPECTED="$(awk -v asset="$DOC" '$2 == asset { print $1 }' "$TEMP_DIR/checksums.txt")"
  DOC_ACTUAL="$(shasum -a 256 "$TEMP_DIR/$DOC" | awk '{ print $1 }')"
  if [ -z "$DOC_EXPECTED" ] || [ "$DOC_ACTUAL" != "$DOC_EXPECTED" ]; then
    echo "SHA-256 verification failed for $DOC" >&2
    exit 1
  fi
done

mkdir -p "$LIB_DIR" "$BIN_DIR" "$DOC_DIR"
mkdir "$STAGE_DIR"
tar -xzf "$TEMP_DIR/$ASSET" -C "$STAGE_DIR"
if [ ! -x "$STAGE_DIR/bin/coweb" ] || [ ! -x "$STAGE_DIR/runtime/bun" ]; then
  echo "Runtime archive is incomplete" >&2
  exit 1
fi
if [ "$("$STAGE_DIR/bin/coweb" --version)" != "$VERSION" ]; then
  echo "Runtime archive version does not match $VERSION" >&2
  exit 1
fi

if [ -e "$TARGET_DIR" ]; then
  mv "$TARGET_DIR" "$BACKUP_DIR"
fi
if ! mv "$STAGE_DIR" "$TARGET_DIR"; then
  if [ -e "$BACKUP_DIR" ]; then mv "$BACKUP_DIR" "$TARGET_DIR"; fi
  exit 1
fi

ln -sfn "$TARGET_DIR/bin/coweb" "$BIN_DIR/.coweb.next"
mv -f "$BIN_DIR/.coweb.next" "$BIN_DIR/coweb"
rm -f "$BIN_DIR/coweb.legacy-standalone"
for DOC in LICENSE Bun-1.4.0.md THIRD_PARTY_NOTICES.txt; do
  install -m 0644 "$TEMP_DIR/$DOC" "$DOC_DIR/$DOC"
done
if [ -e "$BACKUP_DIR" ]; then rm -rf "$BACKUP_DIR"; fi

echo "Installed $TARGET_DIR"
if [ "$#" -gt 0 ]; then
  "$TARGET_DIR/bin/coweb" setup "$@"
  exit 0
fi
echo "Next: $BIN_DIR/coweb setup --browser-only --acknowledge-unofficial"
