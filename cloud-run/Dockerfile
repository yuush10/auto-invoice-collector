# Use official Node.js 18 image
FROM node:18-slim

# Install Chrome dependencies for Puppeteer and VNC components for interactive sessions
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    # VNC dependencies for interactive sessions (Phase 3.6)
    xvfb \
    x11vnc \
    novnc \
    websockify \
    # Required for VNC
    x11-utils \
    dbus-x11 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Create directory for VNC data
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json ./

# Set Puppeteer environment variables before install to skip Chromium download
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install ALL dependencies (including devDependencies for build)
RUN npm install

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
