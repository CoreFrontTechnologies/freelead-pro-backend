FROM node:18-slim

# Set working directory
WORKDIR /app

# Tell Puppeteer to skip downloading Chromium
# We don't need it for scraping — we use axios + cheerio instead
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

# Copy package files first (better Docker layer caching)
COPY package*.json ./

# Install dependencies (Puppeteer won't download Chromium now)
RUN npm install --omit=dev

# Copy the rest of the app
COPY . .

# Create required directories
RUN mkdir -p logs db

# Expose the port Railway uses
EXPOSE 3001

# Start the server
CMD ["node", "server.js"]
