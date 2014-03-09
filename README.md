# GenieACS

GenieACS is a *blazing fast* TR-069 auto configuration server (ACS) built with Node.js, Redis, and MongoDB. It's technology neutral and configurable to fit any service provider needs. This is the core back end component. Official front end GUI is available at https://github.com/zaidka/genieacs-gui.

## Features

* **Massively concurrent**: Can handle hundreds of thousands of connected devices on a single server even with low inform interval.
* **Preset-based configuration**: Define sets of configurations that devices will pick up and apply as needed based on given preconditions.
* **Tagging**: Use tags to group devices for more manageable presets.
* **Searching**: Query for devices on any parameter (supports all common operators including regular expressions).
* **Parameter aliasing**: Define aliases to unify parameter paths from different types of devices. Aliases behave like normal parameters (i.e. can be queried or modified).
* **Extensive API**: A simple yet rich HTTP-based API allows easy integration with other system.

## Getting started

Install [Node.js](http://nodejs.org/), [Redis](http://redis.io/), and [MongoDB](http://www.mongodb.org/). Refer to the corresponding documentation for installation guides. Then use NPM to install GenieACS by typing:

    npm install -g genieacs

You may need to modify the configuration files under "config" directory (in /lib/node_modules/genieacs/config) depending on your setup.

Alternatively, you can use git to get the latest development version (not recommended for production use):

    cd /opt
    git clone https://github.com/zaidka/genieacs.git
    cd genieacs
    npm install
    npm run configure
    npm run compile

Finally, run the following in GNU Screen session or something similar:

    genieacs-cwmp

This is the service that the CPEs will communicate with. It listens to port 7547 by default (see config/config.json). Configure the ACS URL of your devices accordingly.

    genieacs-nbi

This is the northbound interface module. It exposes a REST API on port 7557 by default. This is needed for the GUI front end to communicate with.

    genieacs-fs

This is the file server from which the CPEs will download firmware images and other types of files.

You can use stream redirection to output to log files:

    genieacs-cwmp >> /var/log/genieacs-cwmp.log 2>> /var/log/genieacs-cwmp-err.log
    genieacs-nbi >> /var/log/genieacs-nbi.log 2>> /var/log/genieacs-nbi-err.log
    genieacs-fs >> /var/log/genieacs-fs.log 2>> /var/log/genieacs-fs-err.log

For further details about installation and configuration, refer to the [wiki section](https://github.com/zaidka/genieacs/wiki).

You may now proceed with installing [GenieACS GUI front end](https://github.com/zaidka/genieacs-gui).

## Support

Documentation is still work in progress. Feel free to contact me if you require any assistance in installation, configuration, or using the APIs.

You may submit bug reports or feature requests [here](https://github.com/zaidka/genieacs/issues).

For commercial support options, please contact me.

## Contributing

Contributions are welcome. Fork this repo and open a pull request and wait for feedback. You can also contribute by enhancing the documentation in the [wiki section](https://github.com/zaidka/genieacs/wiki).

