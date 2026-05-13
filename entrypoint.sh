#!/bin/bash

set -e

if [ "$#" -eq 0 ]; then
    exec /opt/genieacs/dist/bin/genieacs-cwmp
elif [ "$1" = "nbi" ]; then
    exec /opt/genieacs/dist/bin/genieacs-nbi
elif [ "$1" = "fs" ]; then
    exec /opt/genieacs/dist/bin/genieacs-fs
elif [ "$1" = "ui" ]; then
    exec /opt/genieacs/dist/bin/genieacs-ui
else
    exec "$@"
fi