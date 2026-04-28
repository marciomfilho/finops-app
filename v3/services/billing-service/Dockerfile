FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY src/ src/
EXPOSE 3002
USER node
CMD ["node", "src/index.js"]
