FROM aquasec/trivy:0.74.0
RUN apk add --no-cache nodejs
COPY dist/index.js /app/index.js
ENTRYPOINT ["node", "/app/index.js"]
