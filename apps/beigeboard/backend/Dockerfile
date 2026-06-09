FROM node:20-slim
WORKDIR /app
COPY package.json .
RUN npm install --omit=dev
COPY server.js .
EXPOSE 8003
ENV PORT=8003
ENV DB_PATH=/data/beigeBoard.db
CMD ["node", "server.js"]
