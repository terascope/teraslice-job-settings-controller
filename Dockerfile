ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine

ENV NODE_ENV=production

COPY service.js package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json /app/source/
COPY src /app/source/src

WORKDIR /app/source

RUN pnpm install && \
    pnpm build

# set up the volume
VOLUME /app/config /app/logs
ENV TERAFOUNDATION_CONFIG=/app/config/terasliceJobSettingsController.yaml

CMD ["sh", "-c", "pnpm start -c $TERAFOUNDATION_CONFIG"]
