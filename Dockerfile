FROM mhart/alpine-node:16
WORKDIR /app
COPY . /app

RUN npm install
RUN npm run build
RUN rm -rf node_modules
RUN npm install --omit dev

FROM mhart/alpine-node:slim-16

WORKDIR /app
COPY --from=0 /app/dist .
COPY --from=0 /app/node_modules ./node_modules
COPY . .
CMD ["node", "main.js"]