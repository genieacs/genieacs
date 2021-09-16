# GenieACS

GenieACS is a high performance Auto Configuration Server (ACS) for remote
management of TR-069 enabled devices. It utilizes a declarative and fault
tolerant configuration engine for automating complex provisioning scenarios at
scale. It's battle-tested to handle hundreds of thousands and potentially
millions of concurrent devices.

## Quick Start

Install [Node.js](http://nodejs.org/) and [MongoDB](http://www.mongodb.org/).
Refer to their corresponding documentation for installation instructions. The
supported versions are:

- Node.js: 12.3+
- MongoDB: 3.6+

Install GenieACS from NPM:

    sudo npm install -g genieacs

To build from source instead, clone this repo or download the source archive
then _cd_ into the source directory then run:

    npm install
    npm run build

Finally, run the following services (found under `./dist/bin/` if building from
source):

### genieacs-cwmp

This is the service that the CPEs will communicate with. It listens on port 7547
by default. Configure the ACS URL in your devices accordingly.

You may optionally use [genieacs-sim](https://github.com/genieacs/genieacs-sim)
as a dummy TR-069 simulator if you don't have a CPE at hand.

### genieacs-nbi

This is the northbound interface module. It exposes a REST API on port 7557 by
default. This one is only required if you have an external system integrating
with GenieACS using this API.

### genieacs-fs

This is the file server from which the CPEs will download firmware images and
such. It listens on port 7567 by default.

### genieacs-ui

This serves the web based user interface. It listens on port 3000 by default.
You must pass _--ui-jwt-secret_ argument to supply the secret key used for
signing browser cookies:

    genieacs-ui --ui-jwt-secret secret

The UI has plenty of configuration options. When you open GenieACS's UI in a
browser you'll be greeted with a database initialization wizard to help you
populate some initial configuration.

Visit [docs.genieacs.com](https://docs.genieacs.com) for more documentation and
a complete installation guide for production deployments.

## Support

The [forum](https://forum.genieacs.com) is a good place to get guidance and help
from the community. Head on over and join the conversation!

For commercial support options, please visit
[genieacs.com](https://genieacs.com/support/).

## License

Copyright 2013-2021 GenieACS Inc. GenieACS is released under the
[AGPLv3 license terms](https://raw.githubusercontent.com/genieacs/genieacs/master/LICENSE).
