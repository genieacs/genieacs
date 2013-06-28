# genie

A blazing fast TR-069 auto configuration server (ACS) built with node.js and MongoDB.

## Features

* *Massively concurrent*: Can handle handreds of thousands of connected devices on a single server even with low inform interval.
* *Preset-based configurations*: Predefine sets of configurations that devices will pick up and apply based on given preconditions.
* *Tagging*: Use tags to group devices for more managable presets.
* *Searching*: Query for devices on any parameter (supports all common operators including regular expressions).
* *Parameter aliases*: Define aliases to unify paramter paths from different types of devices. Aliases behave like normal parameters (i.e. can query on it or set it's value).

## Requirements

* [MongoDB](http://mongodb.org)
* [Node.js driver for MongoDB](https://github.com/mongodb/node-mongodb-native)
* [Memcached](http://memcached.org)
* [node-memcached](https://github.com/3rd-Eden/node-memcached)
* [Libxmljs](https://github.com/polotek/libxmljs)

## Installation notes

* Make sure you enable sockets for memcached and mongodb
* Genie keeps all running tasks in memcached. Increase memcached cache size depending on the number of available devices.

