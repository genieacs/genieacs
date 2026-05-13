# GenieACS v1.2 Dockerfile #
############################

FROM node:20-bullseye

RUN apt-get update && apt-get install -y iputils-ping
RUN mkdir -p /var/log/supervisor

#RUN npm install -g --unsafe-perm genieacs@1.2.11
WORKDIR /opt/genieacs
COPY . .
RUN npm install 
RUN npm i -D tslib
RUN npm run build

RUN useradd --system --no-create-home --user-group genieacs
#RUN mkdir /opt/genieacs
RUN mkdir /opt/genieacs/ext
RUN chown genieacs:genieacs /opt/genieacs/ext

RUN mkdir /var/log/genieacs
RUN chown genieacs:genieacs /var/log/genieacs

ADD genieacs.logrotate /etc/logrotate.d/genieacs

RUN chmod +x ./entrypoint.sh

ENTRYPOINT ["./entrypoint.sh"]