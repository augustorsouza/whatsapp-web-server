#!/bin/bash
set -e  # Exit on any error

echo "Starting WhatsApp Web Server..."

# Ensure data directory exists
mkdir -p /app/data

# Clean up Chrome lock files from previous runs
echo "Cleaning up Chrome lock files..."
find /app/data -name 'SingletonLock' -delete 2>/dev/null || true
find /app/data -name 'SingletonSocket' -delete 2>/dev/null || true
find /app/data -name 'SingletonCookie' -delete 2>/dev/null || true
find /app/data -name 'lockfile' -delete 2>/dev/null || true
find /app/data -name 'Singleton' -delete 2>/dev/null || true
find /app/data -name '*.lock' -delete 2>/dev/null || true
find /app/data -name '.com.google.Chrome.*' -delete 2>/dev/null || true

echo "Chrome lock files cleaned up successfully"

# Check if Chrome is available
if ! command -v $PUPPETEER_EXECUTABLE_PATH &> /dev/null; then
    echo "Warning: Chrome executable not found at $PUPPETEER_EXECUTABLE_PATH"
fi

# Start the Node.js application
echo "Starting Node.js application..."
exec node index.js 