FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY dist/ ./dist/
COPY README.md LICENSE CHANGELOG.md CLAUDE.md ./

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["serve"]
