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
# This dockerfile has two stages:
#
# 1. Building the React application for production
# 2. Setting up our Nginx (Alpine Linux) image w/ step one's output
#


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
FROM node:20.18.1-slim as builder

RUN apt-get update && apt-get install -y build-essential python3
RUN apt-get install unzip


RUN mkdir /usr/src/app
WORKDIR /usr/src/app
RUN npm install -g bun@1.2.23
RUN npm install -g lerna@7.2.0
ENV PATH=/usr/src/app/node_modules/.bin:$PATH

# Do an initial install and then a final install
COPY package.json yarn.lock preinstall.js lerna.json ./
COPY --parents ./addOns/package.json ./addOns/*/*/package.json ./extensions/*/package.json ./modes/*/package.json ./platform/*/package.json ./
COPY --parents ./custom/mode/*/package.json ./custom/extension/*/package.json ./
# Copy the local directory
COPY  --exclude=custom/deploy --exclude=**/.venv/** --exclude=yarn.lock --exclude=package.json --exclude=Dockerfile . .

# Run the install after copying all files for complete workspace context
RUN rm -rf node_modules */*/node_modules .cache .turbo bun.lockb && \
    bun pm cache rm
RUN sed -i '/"@percy\/cypress":/d; /"cypress":/d; /"cypress-file-upload":/d; /"@playwright\/test":/d' package.json
RUN yarn install --no-save

# Build here
# After install it should hopefully be stable until the local directory changes
ENV QUICK_BUILD true
# ENV GENERATE_SOURCEMAP=false
ARG APP_CONFIG=config/default.js
ARG PUBLIC_URL=/
ENV PUBLIC_URL=${PUBLIC_URL}

# RUN bun run show:config
RUN bun run build

# Precompress files
RUN chmod u+x .docker/compressDist.sh
RUN ./.docker/compressDist.sh

# Stage 3: Bundle the built application into a Docker container
# which runs Nginx using Alpine Linux
FROM nginxinc/nginx-unprivileged:1.29-alpine as final

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
COPY --from=builder /usr/src/app/platform/app/dist /usr/share/nginx/html${PUBLIC_URL}
# Copy paths that are renamed/redirected generally
# Microscopy libraries depend on root level include, so must be copied
COPY --from=builder /usr/src/app/platform/app/dist/dicom-microscopy-viewer /usr/share/nginx/html/dicom-microscopy-viewer

# Copy app-config.js
COPY --chown=nginx:nginx custom/deploy/config/app-config.js /usr/share/nginx/html${PUBLIC_URL}app-config.js
RUN chmod 644 /usr/share/nginx/html${PUBLIC_URL}app-config.js

# Copy the entrypoint script
COPY ./platform/app/.recipes/Nginx-Orthanc-Keycloak/config/entrypoint.sh /entrypoint.sh

# In entrypoint.sh, app-config.js might be overwritten, so chmod it to be writeable.
# The nginx user cannot chmod it, so change to root.
USER root
RUN chmod +x entrypoint.sh
RUN chown -R nginx:nginx /usr/share/nginx/html
USER nginx
# Expose necessary ports
EXPOSE 80 443 4180
# Set the entrypoint script as the entrypoint
ENTRYPOINT ["/usr/src/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
