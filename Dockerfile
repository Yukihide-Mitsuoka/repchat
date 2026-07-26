# One image, two services (ADR-0012 T2). The Cloud Run service overrides the
# command to pick control-plane or executor, so both always run identical code.
#
# No build step: Node >= 24 strips TypeScript types natively, which is why the
# test suite already runs .ts directly. Keeping the image source-only avoids a
# bundler dependency and keeps what runs in production identical to what CI ran.

# --- build stage: the only place npm is needed -------------------------------
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit

# --- runtime stage -----------------------------------------------------------
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# npm is a BUILD tool; shipping it puts its bundled dependency tree (tar,
# brace-expansion, undici — none of them ours) into the production attack
# surface, where the image scanner reports their CVEs and we can do nothing
# about them. Nothing at runtime invokes npm, so remove it.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src

# Never run as root; Cloud Run does not require it and least privilege applies
# to the container user too.
USER node

# Cloud Run injects PORT; env.ts reads it and falls back per service.
# Overridden per service in Terraform — this default is only for a bare
# `docker run` and points at the control plane.
CMD ["node", "src/main/control-plane-server.ts"]
