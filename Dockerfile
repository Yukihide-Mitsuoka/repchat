# One image, two services (ADR-0012 T2). The Cloud Run service overrides the
# command to pick control-plane or executor, so both always run identical code.
#
# No build step: Node >= 24 strips TypeScript types natively, which is why the
# test suite already runs .ts directly. Keeping the image source-only avoids a
# bundler dependency and keeps what runs in production identical to what CI ran.
FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first, from the lockfile, so layer caching survives source edits.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit

COPY src ./src

# Never run as root; Cloud Run does not require it and least privilege applies
# to the container user too.
USER node

# Cloud Run injects PORT; env.ts reads it and falls back per service.
# Overridden per service in Terraform — this default is only for a bare
# `docker run` and points at the control plane.
CMD ["node", "src/main/control-plane-server.ts"]
