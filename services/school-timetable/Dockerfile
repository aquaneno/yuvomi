FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node services/school-timetable/package.json ./package.json
COPY --chown=node:node services/school-timetable/package.json services/school-timetable/server.js services/school-timetable/store.js ./services/school-timetable/
COPY --chown=node:node modules/school-timetable/model.js ./modules/school-timetable/model.js
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=3100 TIMETABLE_DB=/data/timetable.db
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD node -e "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "services/school-timetable/server.js"]
