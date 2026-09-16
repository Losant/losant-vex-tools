FROM aquasec/trivy:0.74.0 AS trivy
FROM node:24.21.0-alpine
COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy
COPY dist/index.js /app/index.js
ENTRYPOINT ["node", "/app/index.js"]
