ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine

ENV NODE_ENV=production

COPY service.js package.json yarn.lock tsconfig.json .yarnrc.yml /app/source/
COPY .yarn /app/source/.yarn
COPY src /app/source/src

# this has to include a wildcard because this may not exist
COPY .pnp.* /app/source/

WORKDIR /app/source

RUN yarn install && \
    yarn build

# set up the volume
VOLUME /app/config /app/logs
ENV TERAFOUNDATION_CONFIG=/app/config/terasliceJobSettingsController.yaml

CMD ["sh", "-c", "yarn start -c $TERAFOUNDATION_CONFIG"]