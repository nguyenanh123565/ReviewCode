# Vietnamese pilot image, kept separate from the original Codex example.
FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g --no-audit --no-fund @openai/codex@0.167.0 \
    && npm cache clean --force

WORKDIR /agent
COPY agent.mjs audit.mjs cli-preflight.mjs diagnostic.mjs diff.mjs parse.mjs prompt.mjs review-response.schema.json ./

ENTRYPOINT ["node", "/agent/agent.mjs"]
