FROM node:16.15.0-slim as json-copier

RUN mkdir /usr/src/app
WORKDIR /usr/src/app

COPY ["package.json", "yarn.lock", "preinstall.js", "./"]
COPY extensions /usr/src/app/extensions
COPY modes /usr/src/app/modes
COPY platform /usr/src/app/platform
COPY custom /usr/src/app/custom

# Find and remove non-package.json files
#RUN find extensions \! -name "package.json" -mindepth 2 -maxdepth 2 -print | xargs rm -rf
#RUN find modes \! -name "package.json" -mindepth 2 -maxdepth 2 -print | xargs rm -rf
#RUN find platform \! -name "package.json" -mindepth 2 -maxdepth 2 -print | xargs rm -rf

# Copy Files
FROM node:16.15.0-slim as builder
RUN mkdir /usr/src/app
WORKDIR /usr/src/app

COPY --from=json-copier /usr/src/app .

# Run the install before copying the rest of the files
RUN yarn config set workspaces-experimental true


RUN yarn install --frozen-lockfile

COPY . .

# To restore workspaces symlinks
RUN yarn run cli link-extension /usr/src/app/custom/extension/labeling
RUN yarn run cli link-mode /usr/src/app/custom/mode/labeling-mode

RUN yarn install --frozen-lockfile

ENV PATH /usr/src/app/node_modules/.bin:$PATH
ENV QUICK_BUILD true
# ENV GENERATE_SOURCEMAP=false
# ENV REACT_APP_CONFIG=config/default.js

ENV APP_CONFIG=config/docker_openresty-orthanc.js
ENV PATH /usr/src/app/node_modules/.bin:$PATH

ENV QUICK_BUILD true
RUN yarn run build

# ADD . /usr/src/app/
# RUN yarn install
# RUN yarn run build:web


# Stage 2: Bundle the built application into a Docker container
# which runs openresty (nginx) using Alpine Linux
# LINK: https://hub.docker.com/r/openresty/openresty
FROM openresty/openresty:1.15.8.1rc1-0-alpine-fat

RUN mkdir /var/log/nginx
RUN apk add --no-cache openssl
RUN apk add --no-cache openssl-dev
RUN apk add --no-cache git
RUN apk add --no-cache gcc
# !!!
RUN luarocks install lua-resty-openidc

#
RUN luarocks install lua-resty-jwt
RUN luarocks install lua-resty-session
RUN luarocks install lua-resty-http
# !!!
RUN luarocks install lua-resty-openidc
RUN luarocks install luacrypto

# Copy build output to image
COPY --from=builder /usr/src/app/platform/viewer/dist /var/www/html
COPY --from=builder /usr/src/app/platform/viewer/.recipes/OpenResty-Orthanc/config/nginx.conf /usr/local/openresty/nginx/conf/nginx.conf

ENTRYPOINT ["/usr/local/openresty/nginx/sbin/nginx", "-g", "daemon off;"]
