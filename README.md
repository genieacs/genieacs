# genied

Auto-Configuration Server (ACS) built with node.js and MongoDB

## Requirements

* [MongoDB](http://mongodb.org)
* [Node.js driver for MongoDB](https://github.com/mongodb/node-mongodb-native)
* [Memcached](http://memcached.org)
* [node-memcached](https://github.com/3rd-Eden/node-memcached)
* [Libxmljs](https://github.com/polotek/libxmljs)

## Installation notes

* Make sure you enable sockets for memcached and mongodb
* genied keeps all running tasks in memcached. Increase memcached cache size depending on the number of available devices.

