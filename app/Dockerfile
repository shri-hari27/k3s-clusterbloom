# Small, production-lean Node image
FROM node:18-alpine

WORKDIR /app

# Install dependencies first so Docker can cache this layer
# separately from application code changes
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Now copy the actual application code
COPY server.js ./
COPY public ./public

EXPOSE 3000

# Run as a non-root user inside the container — defense in depth,
# on top of the RBAC restrictions already applied at the Kubernetes level
USER node

CMD ["node", "server.js"]