FROM node:12 as builder

WORKDIR /usr/src/app
COPY package.json .
RUN npm i

COPY . .
RUN npm run build

# ---
FROM node:12-slim

COPY --from=builder /usr/src/app/dist /genieacs
WORKDIR /genieacs
RUN npm i --production

CMD [ "/genieacs/bin/genieacs-cwmp" ]
