.. _administration-faq:

Administration FAQ
==================

.. _administration-faq-duplicate-log-entries:

Duplicate log entries when using :func:`log()` function
-------------------------------------------------------

Because GenieACS uses a full fledged scripting language for device
configuration, the only way to guarantee that it has satisfied the 'desired
state' is by repeatedly executing the script until there's no more
discrepancies with the current device state. Though it may seem like this will
cause duplicate requests going to the device, this isn't actually the case
because device configuration are stated declaratively and that the scripts
themselves are pure functions in the context of a session (e.g. Date.now()
always returns the same value within the session).

To illustrate with an example, consider the following script:

.. code:: javascript

  log("Executing script");
  declare("Device.param", null, {value: 1});
  commit();
  declare("Device.param", null, {value: 2});

This will set the value of the 'Device.param' to 1, then to 2. Then as the
script is run again the value is set back to 1 and so on. A stable state will
never be reached so GenieACS will execute the script a few times until it gives
up and throws a fault. This is an edge case that should be avoided. A more
typical case is where the script is run once or twice. Essentially if an
execution doesn't result in any request to the CPE or a change in the data
model then a stable state is deemed to have been reached.

Configurations not pushed to device after factory reset
---------------------------------------------------------

After a device is reset to its factory default state, the cached data model in
GenieACS's database needs to be invalidated to force rediscovery. Ensure the
following lines are called on ``0 BOOTSTRAP`` event:

.. code:: javascript

  const now = Date.now();

  // Clear cached data model to force a refresh
  clear("Device", now);
  clear("InternetGatewayDevice", now);


Most device parameters are missing
----------------------------------

For performance reasons (server, client, and network), GenieACS by default only
fetches parts of the data model that are necessary to satisfy the declarations
in your provision scripts. Create declarations for any parameters you need
fetched by default.

If you're unsure and want to explore the available parameters exposed by the
device, refresh the root parameter (e.g. ``InternetGatewayDevice``) from
GenieACS's UI. You typically only need to do that one time for a given CPE
model.
