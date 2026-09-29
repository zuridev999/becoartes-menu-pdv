#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
LIO_ANDROID_SDK="${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}"
LIO_APKSIGNER="$LIO_ANDROID_SDK/build-tools/35.0.0/apksigner"
LIO_KEYSTORE="${LIO_RELEASE_KEYSTORE:-/Users/guimameluco/Library/Application Support/Becoartes/LIO/becoartes-lio-release.p12}"
LIO_KEY_ALIAS="${LIO_RELEASE_KEY_ALIAS:-becoartes-lio}"
LIO_KEYCHAIN_SERVICE="${LIO_RELEASE_KEYCHAIN_SERVICE:-Becoartes LIO release signing}"

test -f build/becoartes-lio-release-unsigned.apk || { echo "Build the unsigned APK first." >&2; exit 1; }
test -f "$LIO_KEYSTORE" || { echo "Release keystore not found." >&2; exit 1; }
LIO_KEY_PASSWORD="$(security find-generic-password -s "$LIO_KEYCHAIN_SERVICE" -a "$LIO_KEY_ALIAS" -w)"
trap 'unset LIO_KEY_PASSWORD' EXIT

"$LIO_APKSIGNER" sign \
  --ks "$LIO_KEYSTORE" \
  --ks-key-alias "$LIO_KEY_ALIAS" \
  --ks-pass "pass:$LIO_KEY_PASSWORD" \
  --key-pass "pass:$LIO_KEY_PASSWORD" \
  --v2-signing-enabled true \
  --out build/becoartes-lio-release.apk \
  build/becoartes-lio-release-unsigned.apk

"$LIO_APKSIGNER" verify --verbose --print-certs build/becoartes-lio-release.apk
shasum -a 256 build/becoartes-lio-release.apk
