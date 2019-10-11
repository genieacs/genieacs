.. _provisions:

Provisions
==========

A Provision is a piece of JavaScript code that is executed on the server on a
per-device basis. It enables implementing complex provisioning scenarios and
other operations such as automated firmware upgrade rollout. Apart from a few
special functions, the script is essentially a standard ES6 code executed in
strict mode.

Provisions are mapped to devices using presets. Note that the added performance
overhead when using Provisions as opposed to simple preset configuration
entries is relatively small. Anything that can be done via preset
configurations can be done using a Provision script. In fact, the now
deprecated configuration format is still supported primarily for backward
compatibility and it is recommended to use Provision scripts for all
configuration.

When assigning a Provision script to a preset, you may pass arguments to the
script. The arguments can be accessed from the script through the global
``args`` variable.

.. note::

  Provision scripts may get executed multiple times in a given session.
  Although all data model-mutating operations are idempotent, a script as a
  whole may not be. It is, therefore, necessary to repeatedly run the script
  until there are no more side effects and a stable state is reached.

Built-in functions
------------------

``declare(path, timestamps, values)``
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

This function is for declaring parameter values to be set, as well as specify
constraints on how recent you'd like the parameter value (or other attributes)
to have been refreshed from the device. If the given timestamp is lower than
the timestamp of the last refresh from the device, then this function will
return the last known value. Otherwise, the value will be fetched from the
device before being returned to the caller.

The timestamp argument is an object where the key is the attribute name (e.g.
``value``, ``object``, ``writable``, ``path``) and the value is an integer
representing a Unix timestamp.

The values argument is an object similar to the timestamp argument but its
property values being the parameter values to be set.

The possible attributes in 'timestamps' and 'values' arguments are:

- ``value``: a [<value>, <type>] pair

This attribute is not available for objects or object instances. If the value
is not a [<value>, <type>] array then it'll assumed to be a value without a
type and therefore the type will be inferred from the parameter's type.

- ``writable``: boolean

The meaning of this attribute can vary depending on the type of the parameter.
In the case of regular parameters, it indicates if its value is writable. In
the case of objects, it's whether or not it's possible to add new object
instances. In the case of object instances, it indicates whether or not this
instance can be deleted.

- ``object``: boolean

True if this is an object or object instance, false otherwise.

- ``path``: string

This attribute is special in that it's not a parameter attribute per se, but it
refers to the presence of parameters matching the given path. For example,
given the following wildcard path:

``InternetGatewayDevice.LANDevice.1.Hosts.Host.*.MACAddress``

Using a recent timestamp for path in ``declare()`` will result in a sync with
the device to rediscover all Host instances (``Host.*``). The path attribute
can also be used to create or delete object instances as described in
:ref:`path-format` section.

The return value of ``declare()`` is an iterator to access parameters that
match the given path. Each item in the iterator has the attribute 'path' in
addition to any other attribute given in the ``declare()`` call. The iterator
object itself has convenience attribute accessors which come in handy when
you're expecting a single parameter (e.g. when path does not contain wildcards
or aliases).

.. code:: javascript

  // Example: Setting the SSID as the last 6 characters of the serial number
  let serial = declare("Device.DeviceInfo.SerialNumber", {value: 1});
  declare("Device.LANDevice.1.WLANConfiguration.1.SSID", null, {value: serial.value[0]});

``clear(path, timestamp)``
~~~~~~~~~~~~~~~~~~~~~~~~~~

This function invalidates the database copy of parameters (and their child
parameters) that match the given path and have a last refresh timestamp that is
less than the given timestamp. The most obvious use for this function is to
invalidate the database copy of the entire data model after the device has been
factory reset:

.. code:: javascript

  // Example: Clear cached device data model Note
  // Make sure to apply only on "0 BOOTSTRAP" event
  clear("Device", Date.now());
  clear("InternetGatewayDevice", Date.now());

``commit()``
~~~~~~~~~~~~

This function commits the pending declarations and performs any necessary sync
with the device. It's usually not required to call this function as it called
implicitly at the end of the script and when accessing any property of the
promise-like object returned by the ``declare()`` function. Calling this
explicitly is only necessary if you want to control the order in which
parameters are configured.

``ext(file, function, arg1, arg2, ...)``
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Execute an extension script and return the result. The first argument is the
script filename while second argument is the function name within that script.
Any remaining arguments will be passed to that function. See :ref:`extensions`
for more details.

``log(message)``
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Prints out a string in genieacs-cwmp's access log. It's meant to be used for
debugging. Note that you may see multiple log entries as the script can be
executed multiple times in a session. See :ref:`this FAQ
<administration-faq-duplicate-log-entries>`.

.. _path-format:

Path format
-----------

A parameter path may contain a wildcard (``*``) or an alias filter
(``[name:value]``). A wildcard segment in a parameter path will apply the
declared configuration to zero or more parameters that match the given path
where the wildcard segment can be anything.

An alias filter is like a wildcard, but additionally performs filtering on the
child parameters based on the key-value pairs provided. For example, the
following path:

``Device.WANDevice.1.WANConnectionDevice.1.WANIPConnection.[AddressingType:DHCP].ExternalIPAddress``

will return a list of ExternalIPAddress parameters (0 or more) where the
sibling parameter AddressingType is assigned the value "DHCP".

This can be useful when the exact instance numbers may be different from one
device to another. It is possible to use more than one key-value pair in the
alias filter. It's also possible to use multiple filters or use a combination
of filters and wildcards.

Creating/deleting object instances
----------------------------------

Given the declarative nature of provisions, we cannot explicitly tell the
device to create or delete an instance under a given object. Instead, we
specify the number of instances we want there to be, and based on that GenieACS
will determine whether or not it needs to create or delete instances. For
example, the following declaration will ensure we have one and only one
WANIPConnection object:

.. code:: javascript

  // Example: Ensure we have one and only one WANIPConnection object
  declare("InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.*", null, {path: 1});

Note the wildcard at the end of the parameter path.

It is also possible to use alias filters as the last path segment which will
ensure that the declared number of instances is satisfied given the alias
filter:

.. code:: javascript

  // Ensure that *all* other instances are deleted
  declare("InternetGatewayDevice.X_BROADCOM_COM_IPAddrAccCtrl.X_BROADCOM_COM_IPAddrAccCtrlListCfg.[]", null, {path: 0});

  // Add the two entries we care about
  declare("InternetGatewayDevice.X_BROADCOM_COM_IPAddrAccCtrl.X_BROADCOM_COM_IPAddrAccCtrlListCfg.[SourceIPAddress:192.168.1.0,SourceNetMask:255.255.255.0]",  {path: now}, {path: 1});
  declare("InternetGatewayDevice.X_BROADCOM_COM_IPAddrAccCtrl.X_BROADCOM_COM_IPAddrAccCtrlListCfg.[SourceIPAddress:172.16.12.0,SourceNetMask:255.255.0.0]", {path: now}, {path: 1});

Special GenieACS parameters
---------------------------

In addition to the parameters exposed in the device's data model through
TR-069, GenieACS has its own set of special parameters:

``DeviceID``
~~~~~~~~~~~~

This parameter sub-tree includes the following read-only parameters:

- ``DeviceID.ID``
- ``DeviceID.SerialNumber``
- ``DeviceID.ProductClass``
- ``DeviceID.OUI``
- ``DeviceID.Manufacturer``

``Tags``
~~~~~~~~

The ``Tags`` root parameter is used to expose device tags in the data model.
Tags appear as child parameters that are writable and have boolean value.
Setting a tag to ``false`` will delete that tag, and setting the value of a
non-existing tag parameter to ``true`` will create it.

.. code:: javascript

  // Example: Remove "tag1", add "tag2", and read "tag3"
  declare("Tags.tag1", null, {value: false});
  declare("Tags.tag2", null, {value: true});
  let tag3 = declare("Tags.tag3", {value: 1});

``Reboot``
~~~~~~~~~~

The ``Reboot`` root parameter hold the timestamp of the last reboot command.
The parameter value is writable and declaring a timestamp value that is larger
than the current value will trigger a reboot.

.. code:: javascript

  // Example: Reboot the device only if it hasn't been rebooted in the past 300 seconds
  declare("Reboot", null, {value: Date.now() - (300 * 1000)});

``FactoryReset``
~~~~~~~~~~~~~~~~

Works like ``Reboot`` parameter but for factory reset.

.. code:: javascript

  // Example: Default the device to factory settings
  declare("FactoryReset", null, {value: Date.now()});

``Downloads``
~~~~~~~~~~~~~

The ``Downloads`` sub-tree holds information about the last download
command(s). A download command is represented as an instance (e.g.
``Downloads.1``) containing parameters such as ``Download`` (timestamp),
``LastFileType``, ``LastFileName``. The parameters ``FileType``, ``FileName``,
``TargetFileName`` and ``Download`` are writable and can be used to trigger a
new download.

.. code:: javascript

  declare("Downloads.[FileType:1 Firmware Upgrade Image]", {path: 1}, {path: 1});
  declare("Downloads.[FileType:1 Firmware Upgrade Image].FileName", {value: 1}, {value: "firmware-2017.01.tar"});
  declare("Downloads.[FileType:1 Firmware Upgrade Image].Download", {value: 1}, {value: Date.now()});

Common file types are:

- ``1 Firmware Upgrade Image``
- ``2 Web Content``
- ``3 Vendor Configuration File``
- ``4 Tone File``
- ``5 Ringer File``

.. warning::

  Pushing a file to the device is often a service-interrupting operation. It's
  recommended to only trigger it on certain events such as ``1 BOOT`` or during
  a predetermined maintenance window).

After the CPE had finished downloading and applying the config file, it will
send a ``7 TRANSFER COMPLETE`` event. You may use that to trigger a reboot
after the firmware image or configuration file had been applied.
