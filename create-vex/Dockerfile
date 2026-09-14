FROM aquasec/trivy:latest
RUN apk add --no-cache nodejs
COPY dist/index.js /app/index.js
ENTRYPOINT ["node", "/app/index.js"]
