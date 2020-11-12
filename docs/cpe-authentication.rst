.. _cpe-authentication:

CPE Authentication
==================

CPE to ACS
----------

.. note::

  By default GenieACS will accept any incoming connection via HTTP/HTTPS and
  respond to it.

The following paramters are used to set and get (password is redacted but
can be set) the username/password used to authenticate against the ACS:

Username: ``Device.ManagementServer.Username`` or ``InternetGatewayDevice.ManagementServer.Username``

Password: ``Device.ManagementServer.Password`` or ``InternetGatewayDevice.ManagementServer.Password``

Enable CPE to ACS Authentication
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

CPE to ACS authentication can be configured in the web interface by using the
`Config` option in the `Admin` tab.

Go to the `Admin` -> `Config` page and click on `New config` button at the
bottom of the page. This will open pop-up which requires you to fill in a key
and value. The key should be ``cwmp.auth``. The value accepts a boolean.
Setting the value to ``true`` makes it so that GenieACS accepts any incoming
connection, setting it to ``false`` makes GenieACS deny all incoming
connections. This can be further configured using the ``AUTH()`` and ``EXT()``
functions.

The ``AUTH()`` function
~~~~~~~~~~~~~~~~~~~~~~~

The ``AUTH()`` function accepts two parameters, username and password. It
checks the given username and password with the incoming request to determine
whether to return true or false.

Basic usage of the ``AUTH()`` function could be as follows:

.. code:: sql

   AUTH("fixed-username", "fixed-password")

This will only accept incoming request who authenticate with
"fixed-username" and "fixed-password".

The various device parameters can be referenced from within the ``cwmp.auth``
expression. For example:

.. code:: sql

   AUTH(Device.ManagementServer.Username, Device.ManagementServer.Password)

The ``EXT()`` function
~~~~~~~~~~~~~~~~~~~~~~

The ``EXT()`` function makes it possible to call an :ref:`extension
<extensions>` script from the auth expression. This can be used to fetch
the credentials from an external source:

.. code:: sql

   AUTH(DeviceID.SerialNumber, EXT("authenticate", "getPassword", DeviceID.SerialNumber))

ACS to CPE
----------

TODO
