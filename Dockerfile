# syntax=docker/dockerfile:1

# The PR image gate needs a real artifact to build, load and scan. Keep this
# file boring: the interesting gates live in .github/workflows/pr.yml.
#
# Size note (docs/EVIDENCE.md): the runtime stage installs only runtime deps.
# `--omit=dev` alone is not enough: @prisma/client declares `prisma` and
# `typescript` as *optional* peerDependencies, and npm ci installs an optional
# peer unless `--omit=optional` is also passed. Without it the runtime image
# carries the whole Prisma CLI, effect and fast-check, none of which it runs.
# The lockfile is deleted after install so the final image ships no dependency
# manifest for Trivy to scan that the container cannot actually execute.

FROM node:22-alpine AS build
WORKDIR /app

# node:22-alpine already ships libssl.so.3 / libcrypto.so.3, which is what the
# Prisma musl engine links against; no apk layer needed.

COPY package.json package-lock.json ./
# The schema is present before `npm ci` so the package's postinstall
# (`prisma generate`) has something to read.
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# DEMO ONLY — this draft PR deliberately pins the shipped runtime to the
# outdated node:18.12.0-alpine base used by the demo's bad-image lane. That
# base (alpine 3.16.2) carries 10 fixable HIGH CVEs, so the trivy gate fails.
FROM node:18.12.0-alpine@sha256:1f09c210a17508d34277971b19541a47a26dc5a641dedc03bd28cff095052996 AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
WORKDIR /app

COPY package.json package-lock.json ./
# npm itself is removed after the install: the runtime entry is `node
# dist/server.js`, and npm's bundled dependency tree (brace-expansion, pacote,
# sigstore, picomatch, ip-address) is the only thing Trivy still flags.
RUN npm ci --omit=dev --omit=optional --omit=peer --ignore-scripts \
 && npm cache clean --force \
 && rm -f package-lock.json \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
# The generated client (including the query engine) comes from the build stage.
# @prisma/client itself is already installed above; copying it again would only
# add a duplicate 70 MB layer.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
# /ready compares applied migrations against what is on disk, so the migration
# directories must exist in the runtime image.
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
