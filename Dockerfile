FROM node:0.10.48

WORKDIR /usr/src/app

COPY . /usr/src/app
RUN npm install && npm run configure && npm run compile

EXPOSE 7777

# Cleanup
RUN npm cache clear
RUN rm -rf /root/.node-gyp /tmp/npm-*
