ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY . .
RUN node scripts/bootstrap-pnpm.mjs /opt/crewbus-pnpm
ENV PATH="/opt/crewbus-pnpm/bin:${PATH}"
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @crewbus/server deploy --prod --legacy /out/server
RUN cp -R apps/web/dist /out/server/public
# Fail the build if deploy leaves dependencies pointing back at the workspace.
RUN node scripts/verify-deploy.mjs /out/server

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
COPY --from=build --chown=node:node /out/server /app
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production CREWBUS_DATA_DIR=/data HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=2s --timeout=3s --start-period=10s --retries=10 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
