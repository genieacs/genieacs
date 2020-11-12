.. _cpe-authentication:

CPE Authentication
==================

CPE to ACS
----------
.. note::

  By default GenieACS will accept any incoming connection via HTTP/HTTPS and 
  respond to it.

The following paramters are used to set and get (password is redacted but 
can be set) the username/password used to authenticate against a ACS: 

``InternetGatewayDevice.ManagementServer.Username``

``InternetGatewayDevice.ManagementServer.Password``

Enable CPE to ACS Authentication
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
CPE to ACS authentication can be configured in the webinterface by using the 
`Config` option in the `Admin` tab.

Go to the `Admin` -> `Config` page and click on `New config` button at the 
bottom of the page. This will open pop-up which requires you to fill in a key 
and value. The key should be ``cwmp.auth``. The value accepts a boolean.
Setting the value to ``true`` makes it so that GenieACS accepts any incoming 
connection, setting it to ``false`` makes GenieACS deny all incoming 
connections. This can be further configured using the AUTH() and EXT() 
functions.

The AUTH() function
~~~~~~~~~~~~~~~~~~~
The AUTH() function accepts two parameters, username and password. The AUTH() 
function checks the given username and password with the incoming request 
to determine whether to return true or false.

Basic usage of the AUTH() function could be as follows:

.. code:: Javascript

  AUTH("fixed-username", "fixed-password")

This will only accept incoming request who authenticate with 
"fixed-username" and "fixed-password".

The option ``cwmp.auth`` creates a usable variable named serialNumber.
This variable holds the serialNumber of the CPE who wants to connect to
GenieACS. The variable can be used as follows:

.. code:: Javascript

  AUTH(serialNumber, "fixed-password")

The EXT() function
~~~~~~~~~~~~~~~~~~
it is possible to replace the AUTH() function with a custom defined script
by utilizing the EXT() function. The EXT() function makes it possible to
load any javascript file located in the ``EXT_DIR``. This script
may make use of the serialNumber variable and must return a boolean in the
callback. See :ref:`extensions` for more details.

.. code:: Javascript

  EXT("authenticate", "authCheck", serialNumber)

Since the username and password are inaccessible when using ``cwmp.auth``
this might not be all that useful.

Combining AUTH() and EXT()
~~~~~~~~~~~~~~~~~~~~~~~~~~
To make the authentication part truly dynamic AUTH() and EXT() can be combined.
This is useful for when every CPE has it own username and password combination
which is stored on an external system. Example of using AUTH() and EXT() 
together:

.. code:: Javascript

  AUTH(EXT(serialNumber, EXT("authenticate", "getPassword", serialNumber))

or

.. code:: Javascript

  AUTH(EXT("authenticate", "getUsername", serialNumber), EXT("authenticate", "getPassword", serialNumber))

Where both the method "getUsername" and "getPassword" should return a string 
in the callback. See :ref:`extensions` for more details.

ACS to CPE
----------
TODO
