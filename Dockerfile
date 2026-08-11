# syntax=docker/dockerfile:1.7-labs
# This dockerfile is used to publish the `ohif/app` image on dockerhub.
#
# It's a good example of how to build our static application and package it
# with a web server capable of hosting it as static content.
#
# docker build
# --------------
# If you would like to use this dockerfile to build and tag an image, make sure
# you set the context to the project's root directory:
# https://docs.docker.com/engine/reference/commandline/build/
#
#
# SUMMARY
# --------------
# This dockerfile is used as an input for a second stage to make things run faster.
#


# Stage 1: Build the application
# docker build -t ohif/viewer:latest .
# Copy Files
# Only needs to be new enough to launch corepack/pnpm: `pnpm install` below
# downloads the exact Node from package.json#devEngines.runtime and runs the
# build with it, so the base image tag does not pin what the build uses.
FROM node:24-slim as builder

RUN apt-get update && apt-get install -y --no-install-recommends build-essential python3 unzip \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /usr/src/app
WORKDIR /usr/src/app
# .npmrc sets manage-package-manager-versions=false, so corepack is what pins the
# pnpm version -- to whatever package.json#packageManager says.
COPY .npmrc ./
COPY package.json ./
RUN corepack enable pnpm && corepack prepare --activate
ENV PATH=/usr/src/app/node_modules/.bin:$PATH

# Copy package manifests first so the install layer caches independently of the
# sources. preinstall.js is included because the root package.json's "preinstall"
# lifecycle script runs during `pnpm install` below, before the full source is
# copied, so the file must already be present.
COPY pnpm-lock.yaml pnpm-workspace.yaml preinstall.js ./
COPY --parents ./extensions/*/package.json ./modes/*/package.json ./platform/*/package.json ./
COPY --parents ./custom/extension/*/package.json ./custom/mode/*/package.json ./

# --frozen-lockfile, same as CI. The image is the one thing we ship that nothing
# else verifies, so a manifest that has drifted from the lockfile has to fail
# here rather than be silently reconciled into a different dependency tree.
#
# This used to be --no-frozen-lockfile, on the grounds that .dockerignore
# excludes platform/docs while the lockfile still carries a `platform/docs:`
# importer. That does not hold: pnpm's frozen check compares lockfile importers
# against the workspace packages it DISCOVERS, and a directory absent from the
# build context is never discovered, so there is nothing to conflict. Verified
# against pnpm 11.5.2 by reproducing this layer exactly (lockfile + workspace +
# preinstall.js + all 36 manifests, platform/docs removed): "Lockfile is up to
# date, resolution step is skipped", while the same command with one manifest
# drifted still fails with ERR_PNPM_OUTDATED_LOCKFILE.
#
# Optional deps are kept: platform-native binaries (esbuild/rollup/sharp, ...)
# ship as optionalDependencies and the build needs them. The only download
# suppressed is the heavy Cypress binary, a test-only dependency the production
# build never touches.
ENV CYPRESS_INSTALL_BINARY=0
RUN pnpm install --frozen-lockfile

# Copy the local directory
COPY --exclude=**/.venv/** --exclude=pnpm-lock.yaml --exclude=package.json --exclude=Dockerfile . .

# Build here
# After install it should hopefully be stable until the local directory changes
ENV QUICK_BUILD true
ARG APP_CONFIG=config/default.js
ARG PUBLIC_URL=/
ENV PUBLIC_URL=${PUBLIC_URL}

# RUN pnpm run show:config
RUN pnpm run build

# Upstream's webpack copies the whole of node_modules/onnxruntime-web/dist into
# dist/ort (platform/app/.webpack/webpack.pwa.js), which includes the ONNX
# *training* runtime. The viewer only ever runs inference, so that variant is
# ~11 MB of an image that can never load it. The inference variants are left
# alone: onnxruntime-web picks between them at runtime from SIMD/threads/WebGPU
# capability detection, so dropping one breaks segmentation on whichever
# browsers resolve to it.
RUN rm -f platform/app/dist/ort/ort-training-* platform/app/dist/ort/ort.training.*

# Precompress files
RUN chmod u+x .docker/compressDist.sh
RUN ./.docker/compressDist.sh

# Stage 3: Bundle the built application into a Docker container
# which runs Nginx using Alpine Linux
FROM nginxinc/nginx-unprivileged:1.31-alpine as final

USER root
# Download and install oauth2-proxy
RUN curl -L https://github.com/oauth2-proxy/oauth2-proxy/releases/download/v7.4.0/oauth2-proxy-v7.4.0.linux-amd64.tar.gz -o oauth2-proxy.tar.gz && \
  tar -xvzf oauth2-proxy.tar.gz && \
  mv oauth2-proxy-v7.4.0.linux-amd64/oauth2-proxy /usr/local/bin/ && \
  rm -rf oauth2-proxy-v7.4.0.linux-amd64 oauth2-proxy.tar.gz


#RUN apk add --no-cache bash
ARG PUBLIC_URL=/
ENV PUBLIC_URL=${PUBLIC_URL}
ARG PORT=80
ENV PORT=${PORT}
RUN rm /etc/nginx/conf.d/default.conf
USER nginx
COPY --chown=nginx:nginx .docker/Viewer-v3.x /usr/src
RUN chmod 777 /usr/src/entrypoint.sh
# --chown here rather than a `chown -R` afterwards: a recursive chown rewrites
# every file, and because each layer stores whole files rather than metadata
# deltas, that produced a second complete copy of the ~120 MB tree in the image.
COPY --chown=nginx:nginx --from=builder /usr/src/app/platform/app/dist /usr/share/nginx/html${PUBLIC_URL}
# Copy paths that are renamed/redirected generally
# Microscopy libraries depend on root level include, so must be copied
COPY --chown=nginx:nginx --from=builder /usr/src/app/platform/app/dist/dicom-microscopy-viewer /usr/share/nginx/html/dicom-microscopy-viewer

# Copy app-config.js
COPY --chown=nginx:nginx custom/config/app-config.js /usr/share/nginx/html${PUBLIC_URL}app-config.js
RUN chmod 644 /usr/share/nginx/html${PUBLIC_URL}app-config.js

# Copy the entrypoint script
COPY ./platform/app/.recipes/Nginx-Orthanc-Keycloak/config/entrypoint.sh /entrypoint.sh

# In entrypoint.sh, app-config.js might be overwritten, so chmod it to be writeable.
# The nginx user cannot chmod it, so change to root.
USER root
RUN chmod +x entrypoint.sh
# The html tree is already nginx-owned via COPY --chown above; only the
# directory itself needs adjusting, and non-recursively so the layer stays a
# single inode rather than another full copy of the tree.
RUN chown nginx:nginx /usr/share/nginx/html
USER nginx
# Expose necessary ports
EXPOSE 80 443 4180
# Set the entrypoint script as the entrypoint
ENTRYPOINT ["/usr/src/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
