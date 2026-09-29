#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
# No Gradle download or third-party SDK required: native Android + official Cielo URI contract.
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
LIO_ANDROID_SDK="${ANDROID_SDK_ROOT:-/opt/homebrew/share/android-commandlinetools}"
LIO_BUILD_TOOLS="$LIO_ANDROID_SDK/build-tools/35.0.0"
LIO_ANDROID_JAR="$LIO_ANDROID_SDK/platforms/android-36/android.jar"
for tool in javac jar keytool; do command -v "$tool" >/dev/null || { echo "Missing $tool / JAVA_HOME"; exit 1; }; done
test -f "$LIO_ANDROID_JAR" || { echo "Install Android platform 36 and build-tools 35.0.0"; exit 1; }
mkdir -p build/classes build/dex build/generated
"$LIO_BUILD_TOOLS/aapt2" compile --dir res -o build/resources.zip
"$LIO_BUILD_TOOLS/aapt2" link -o build/resources.apk -I "$LIO_ANDROID_JAR" --manifest AndroidManifest.xml --java build/generated build/resources.zip
find src build/generated -name '*.java' -print > build/sources.list
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options -bootclasspath "$LIO_BUILD_TOOLS/core-lambda-stubs.jar:$LIO_ANDROID_JAR" -d build/classes @build/sources.list
jar cf build/classes.jar -C build/classes .
"$LIO_BUILD_TOOLS/d8" --min-api 24 --lib "$LIO_ANDROID_JAR" --output build/dex build/classes.jar
cp build/resources.apk build/becoartes-lio-unsigned.apk
(cd build/dex && zip -q -u ../becoartes-lio-unsigned.apk classes*.dex)
"$LIO_BUILD_TOOLS/zipalign" -f -p 4 build/becoartes-lio-unsigned.apk build/becoartes-lio-release-unsigned.apk
if [ ! -f build/debug.keystore ]; then
  keytool -genkeypair -keystore build/debug.keystore -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Becoartes Development,OU=Development,O=Becoartes,C=BR"
fi
"$LIO_BUILD_TOOLS/apksigner" sign --ks build/debug.keystore --ks-pass pass:android --key-pass pass:android --v1-signing-enabled true --v2-signing-enabled true --out build/becoartes-lio-debug.apk build/becoartes-lio-release-unsigned.apk
"$LIO_BUILD_TOOLS/apksigner" verify --verbose build/becoartes-lio-debug.apk
shasum -a 256 build/becoartes-lio-debug.apk build/becoartes-lio-release-unsigned.apk
