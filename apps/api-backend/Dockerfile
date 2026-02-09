FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
COPY nx.json ./
COPY tsconfig.base.json ./
COPY .env ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose the API port
EXPOSE 3000

# Start the application
CMD ["npx", "nx", "serve", "api-backend", "--host=0.0.0.0"]
