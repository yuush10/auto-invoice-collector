# Use official Node.js 18 image
FROM node:18-slim

# Install Chrome dependencies for Puppeteer AND Python 3.11 for AI login
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    python3 \
    python3-pip \
    python3-venv \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Set Puppeteer environment variables before install to skip Chromium download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install ALL dependencies (including devDependencies for build)
RUN npm install

# Copy Python requirements and install (before copying all source for caching)
COPY python/requirements.txt ./python/
RUN pip3 install --no-cache-dir --break-system-packages -r python/requirements.txt

# Install Playwright browsers for browser-use
# Note: browser-use uses Playwright, which needs its own browser
RUN python3 -m playwright install chromium --with-deps || true

# Set Python path for AI login scripts
ENV PYTHON_PATH=/usr/bin/python3
ENV AI_LOGIN_SCRIPT_PATH=/app/python/ai_login.py

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --production

# Expose port
EXPOSE 8080

# Run the application
CMD ["npm", "start"]
