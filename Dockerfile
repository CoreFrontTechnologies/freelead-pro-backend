FROM node:18

WORKDIR /app

# Skip Puppeteer Chromium (we don't need it)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

# Copy package files
COPY package*.json ./

# Install dependencies (node:18 has build tools for sqlite3)
RUN npm install --omit=dev

# Copy app files
COPY . .

# Create required directories
RUN mkdir -p logs db

EXPOSE 3001

CMD ["node", "server.js"]
