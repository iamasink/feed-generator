FROM node:lts-iron AS dependencies

# Set the working directory
WORKDIR /usr/src/app

# Copy only package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install -g pnpm
RUN pnpm install

# Stage 2: Compile code
FROM dependencies AS builder

# Copy the source code
COPY src ./src
COPY tsconfig.json ./

# Compile TypeScript code
RUN npm run build

# Stage 3: Create the production image
FROM node:lts-iron AS prod

# Set the working directory
WORKDIR /usr/src/app

# Copy the node_modules directory from the dependencies stage
COPY --from=dependencies /usr/src/app/node_modules ./node_modules

# Copy the compiled application code
COPY --from=builder /usr/src/app/dist ./dist

ENV NODE_ENV=prod

# Start the app
CMD ["node", "dist/index.js"]