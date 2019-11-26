.. _virtual-parameters:

Virtual Parameters
==================

Virtual parameters are user-defined parameters whose values are generated using
a custom Javascript code. Virtual parameters behave just like regular
parameters and appear in the data model under ``VirtualParameters.`` path.
Virtual parameter names cannot contain a period (``.``).

The execution environment for virtual parameters is almost identical to that of
provisions. See :ref:`provisions` for more details and examples. The only
differences between the scripts of provisions and virtual parameters are:

- You can't pass custom arguments to virtual parameter scripts. Instead, the
  variable ``args`` will hold the current vparam timestamps and values as well
  as the declared timestamps and values. Like this:

.. code:: javascript

  // [<current attr timestamps>, <current attr values>, <declared attr timestamps, declared attr values>]
  [{path: 1559840000000, value: 1559840000000}, {value: ["cur val", "xsd:string"]}, {path: 1559849387191, value: 1559849387191}, {value: ["new val", "xsd:string"]}]

- Virtual parameter scripts must return an object containing the attributes of
  this parameter.

.. note::

  Just like a regular parameter, creating a virtual parameter does not
  automatically add it to the parameter list for a device. It needs to fetched
  (manually or via a preset) before you can see it in the data model.

Examples
--------

Unified MAC parameter across different device models
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: javascript

  // Example: Unified MAC parameter across different device models
  let m = "00:00:00:00:00:00";
  let d = declare("Device.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.MACAddress", {value: Date.now()});
  let igd = declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANPPPConnection.*.MACAddress", {value: Date.now()});

  if (d.size) {
    for (let p of d) {
      if (p.value[0]) {
        m = p.value[0];
        break;
      }
    }  
  }
  else if (igd.size) {
    for (let p of igd) {
      if (p.value[0]) {
        m = p.value[0];
        break;
      }
    }  
  }

  return {writable: false, value: [m, "xsd:string"]};

Expose an external value as a virtual parameter
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: javascript

  // Example: Expose an external value as a virtual parameter
  let serial = declare("DeviceID.SerialNumber", {value: 1});
  if (args[1].value) {
    ext("example-ext", "set", serial.value[0], args[1].value[0]);
    return {writable: true, value: [args[1].value[0], "xsd:string"]};
  }
  else {
    let v = ext("example-ext", "get", serial.value[0]);
    return {writable: true, value: [v, "xsd:string"]};
  }

Create an editable virtual parameter for WPA passphrase
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: javascript

  // Example: Create an editable virtual parameter for WPA passphrase
  let m = "";
  if (args[1].value) {
    m = args[1].value[0];
    declare("Device.WiFi.AccessPoint.1.Security.KeyPassphrase", null, {value: m});
    declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", null, {value: m});
  }
  else {
    let d = declare("Device.WiFi.AccessPoint.1.Security.KeyPassphrase", {value: Date.now()});
    let igd = declare("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase", {value: Date.now()});

    if (d.size) {
      m = d.value[0];
    }
    else if (igd.size) {
      m = igd.value[0];  
    }
  }

  return {writable: true, value: [m, "xsd:string"]};
