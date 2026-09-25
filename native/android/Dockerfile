# The Android build environment for the jkOS shells. Built and run by build.mjs — you should
# not need to invoke docker yourself.
#
# It holds a toolchain and nothing else: the project is bind-mounted at run time, so the
# image never goes stale against the source. The toolchain is installed by the SAME script a
# local SDK uses (toolchain.mjs, pinned by toolchain.json), so moving off Docker later
# changes nothing about what gets built.
#
# ⚠️ Building this image accepts the Android SDK licences (--accept-licenses): an image build
# cannot answer the prompt. Building it is your acceptance.

# node:20-slim — the suite's own app base image — pinned by digest (resolved 2026-09-24).
FROM node:20-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0

RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY toolchain.json toolchain.mjs /opt/jkos-toolchain/
RUN node /opt/jkos-toolchain/toolchain.mjs install /opt/android --accept-licenses \
 && rm -rf /opt/android/.downloads

ENV JAVA_HOME=/opt/android/jdk \
    ANDROID_HOME=/opt/android/sdk
