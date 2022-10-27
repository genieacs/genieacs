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
RUN touch logs/genieacs-fs-access.log


ENV GENIEACS_FS_ACCESS_LOG_FILE=./logs/genieacs-fs-access.log
ENV GENIEACS_DEBUG_FILE=./logs/genieacs-debug.yaml
ENV GENIEACS_EXT_DIR=./genieacs/genieacs/ext
ENV NODE_OPTIONS="--enable-source-maps UV_THREADPOOL_SIZE=12 max_old_space_size=4096"
ENV GENIEACS_EXT_TIMEOUT=15000
ENV GENIEACS_MAX_COMMIT_ITERATIONS=10000
ENV GENIEACS_FS_INTERFACE=0.0.0.0
ENV GENIEACS_MAX_CONCURRENT_REQUESTS=20000
ENV GENIEACS_FS_HOSTNAME=127.0.0.1
ENV GENIEACS_FS_LOG_FILE=./logs/genieacs-fs.log


EXPOSE 7567
CMD "dist/bin/genieacs-fs"