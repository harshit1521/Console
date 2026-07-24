FROM node:20-slim

# Create and set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json first to leverage Docker's layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies so tsx and typescript are available)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Expose the port the WebSocket server runs on
EXPOSE 8080

# Set environment variable to production for running optimizations
ENV NODE_ENV=production

# Start the application
CMD ["npx", "nodemon"]
