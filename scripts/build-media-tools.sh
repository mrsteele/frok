#!/usr/bin/env bash
set -eo pipefail
# Called by media-tools.mjs in an isolated build directory. Never installs to the OS.
prefix="$PWD/install"
export PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
# pkgconf's own prefix is private, not a compiler system include/lib directory.
export PKG_CONFIG_ALLOW_SYSTEM_CFLAGS=1
export PKG_CONFIG_ALLOW_SYSTEM_LIBS=1
export PATH="$prefix/bin:$PATH"
export CFLAGS="-O2"
export CXXFLAGS="-O2"
export LDFLAGS=""
export CC=cc
jobs="${FROK_MEDIA_BUILD_JOBS:-4}"
case "$jobs" in ''|*[!0-9]*|0) echo 'FROK_MEDIA_BUILD_JOBS must be a positive integer'; exit 1;; esac
target=()
x264target=()
asm=()
case "$(uname -s)" in
  Darwin) export MACOSX_DEPLOYMENT_TARGET=11.0; export CC=clang;;
  MINGW*|MSYS*) export CC=gcc; target=(--target-os=mingw32 --extra-ldflags=-static); x264target=(--host=x86_64-w64-mingw32);;
esac
if [[ "$(uname -m)" == x86_64 ]] && ! command -v nasm >/dev/null; then
  asm=(--disable-asm)
fi
cd pkgconf
./configure --prefix="$prefix" --disable-shared --enable-static
make -j"$jobs"
make install
cd ../zlib
./configure --prefix="$prefix" --static
make -j"$jobs"
make install
cd ../x264
./configure --prefix="$prefix" --enable-static --enable-pic --disable-cli --disable-opencl --disable-lavf --disable-swscale --disable-ffms --disable-gpac "${x264target[@]}" "${asm[@]}"
make -j"$jobs"
make install-lib-static
cd ../ffmpeg
trap 'tail -n 80 ffbuild/config.log 2>/dev/null || true' ERR
./configure --prefix="$prefix" --cc="$CC" --disable-autodetect --disable-shared --enable-static --disable-debug --disable-doc --disable-ffplay --disable-network --disable-nonfree --enable-gpl --enable-version3 --enable-libx264 --enable-zlib --pkg-config="$prefix/bin/pkgconf" --pkg-config-flags=--static "${target[@]}" "${asm[@]}"
make -j"$jobs"
make install
