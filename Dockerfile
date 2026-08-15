# The desk runs as a non root user on the LTS line the team develops against.
# Two stages so the production image never carries jest, supertest or the
# mongod binary the tests download.
FROM node:20.18.1-bookworm-slim AS dependencies

WORKDIR /srv/printdesk
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

COPY package.json package-lock.json ./
RUN npm ci --omit=dev


FROM node:20.18.1-bookworm-slim AS runtime

# tini reaps the zombies a node process leaves behind when it shells out, and
# gives the container a PID 1 that forwards SIGTERM to the desk.
RUN apt-get update \
    && apt-get install --no-install-recommends -y tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/printdesk
ENV NODE_ENV=production \
    PORT=4010 \
    NODE_OPTIONS=--enable-source-maps

# Which commit this image is. Passed in by the build rather than read from a
# .git directory, because the image does not carry one.
ARG GIT_COMMIT=unknown
ARG BUILT_AT=unknown
RUN printf '{"commit":"%s","builtAt":"%s"}\n' "$GIT_COMMIT" "$BUILT_AT" > /srv/printdesk/build.json

COPY --from=dependencies /srv/printdesk/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts/healthcheck.js ./scripts/healthcheck.js

# node:20 ships a `node` user with no write access to the application. The desk
# writes nothing to disk, so it never needs any.
USER node

EXPOSE 4010

HEALTHCHECK --interval=20s --timeout=4s --start-period=15s --retries=3 \
    CMD ["node", "scripts/healthcheck.js"]

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/http/server.js"]
