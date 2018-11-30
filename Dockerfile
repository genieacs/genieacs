FROM node:8-alpine as build

MAINTAINER Bezerra <paulobezerr@hotmail.com>

RUN apk update && apk add build-base python

ADD . /usr/lib/genieacs
WORKDIR /usr/lib/genieacs
RUN npm install
RUN npm run compile
RUN npm run configure

# The final build does not have build packages, only genieacs.
FROM node:8-alpine

COPY --from=build /usr/lib/genieacs /usr/lib/genieacs/

# This file is mandatory, even when we use environment variables
RUN cp /usr/lib/genieacs/config/config-sample.json /usr/lib/genieacs/config.json

# Create symlinks to easy run genieacs scripts
RUN ln -s /usr/lib/genieacs/bin/genieacs-cwmp /usr/bin/genieacs-cwmp
RUN ln -s /usr/lib/genieacs/bin/genieacs-fs   /usr/bin/genieacs-fs
RUN ln -s /usr/lib/genieacs/bin/genieacs-nbi  /usr/bin/genieacs-nbi

# To development mode, this will help to run commands
WORKDIR /usr/lib/genieacs
