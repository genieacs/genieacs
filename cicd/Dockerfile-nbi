FROM node:16-alpine
WORKDIR /app
RUN npm config set unsafe-perm true
RUN npm install -g ts
RUN npm install -g typescript
RUN npm install -g gulp
RUN npm install -g ts-node
COPY package*.json ./
RUN npm install
COPY --chown=node:node . .
RUN npm run build
RUN mkdir logs
RUN touch logs/genieacs-nbi-access.log


ENV GENIEACS_NBI_ACCESS_LOG_FILE=./logs/genieacs-nbi-access.log
ENV GENIEACS_DEBUG_FILE=./logs/genieacs-debug.yaml
ENV GENIEACS_EXT_DIR=./genieacs/genieacs/ext
ENV NODE_OPTIONS="--enable-source-maps UV_THREADPOOL_SIZE=12 max_old_space_size=4096"
ENV GENIEACS_EXT_TIMEOUT=15000
ENV GENIEACS_MAX_COMMIT_ITERATIONS=10000
ENV GENIEACS_MAX_CONCURRENT_REQUESTS=20000
ENV GENIEACS_NBI_WORKER_PROCESSES=1


EXPOSE 7557 
CMD "dist/bin/genieacs-nbi"