API Reference
=============

GenieACS expoeses a rich RESTful API through its NBI component. This document
serves as a reference for the available APIs.

This API makes use of MongoDB's query language in some of its endpoints. Refer
to MongoDB's documentation for details.

.. note::

  The examples below use ``curl`` command for simplicity and ease of testing.
  Query parameters are URL-encoded, but the original pre-encoding values are
  shown for reference. These examples assume genieacs-nbi is running locally
  and listening on the default NBI port (7557).

.. warning::

  A common pitfll is not properly percent-encoding special characters in the
  device ID or query in the URL.

Endpoints
---------

GET /\<collection\>/?query=\<query\>
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Search for records in the database (e.g. devices, tasks, presets, files).
Returns a JSON representation of all items in the given collection that match
the search criteria.

*collection*: The data collection to search. Could be one of: tasks, devices,
presets, objects.

*query*: Search query. Refer to MongoDB queries for reference.

Examples
^^^^^^^^

- Find a device by its ID:

.. code:: javascript

  query = {"_id": "202BC1-BM632w-0000000"}

.. code:: bash

  curl -i 'http://localhost:7557/devices/?query=%7B%22_id%22%3A%22202BC1-BM632w-0000000%22%7D'

- Find a device by its MAC address:

.. code:: javascript

  query = {
    "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress": "20:2B:C1:E0:06:65"
  }

.. code:: bash

  curl -i 'http://localhost:7557/devices/?query=%7B%22InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress%22%3A%2220:2B:C1:E0:06:65%22%7D'

- Search for devices that have not initiated an inform in the last 7 days.

.. code:: javascript

  query = {
    "_lastInform": {
      "$lt" : "2017-12-11 13:16:23 +0000"
    }
  }

.. code:: bash

  curl -i 'http://localhost:7557/devices/?query=%7B%22_lastInform%22%3A%7B%22%24lt%22%3A%222017-12-11%2013%3A16%3A23%20%2B0000%22%7D%7D'

- Show pending tasks for a given device:

.. code:: javascript

  query = {"device": "202BC1-BM632w-0000000"}

.. code:: bash

  curl -i 'http://localhost:7557/tasks/?query=%7B%22device%22%3A%22202BC1-BM632w-0000000%22%7D'

- Return specific parameters for a given device:

.. code:: javascript

  query = {"_id": "202BC1-BM632w-0000000"}

.. code:: bash

  curl -i 'http://localhost:7557/devices?query=%7B%22_id%22%3A%22202BC1-BM632w-0000000%22%7D&projection=InternetGatewayDevice.DeviceInfo.ModelName,InternetGatewayDevice.DeviceInfo.Manufacturer'

The ``projection`` URL param is a comma-separated list of the parameters to receive.

POST /devices/\<device_id\>/tasks?[connection_request]
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Enqueue task(s) and optionally trigger a connection request to the device.
Refer to :ref:`tasks` section for information about the task object format.
Returns status code 200 if the tasks have been successfully executed, and 202
if the tasks have been queued to be executed at the next inform.

*device_id*: The ID of the device.

*connection_request*: Indicates that a connection request will be triggered to
execute the tasks immediatly. Otherwise, the tasks will be queued and be
processed at the next inform.

The response body is the task object as it is inserted in the database. The
object will include ``_id`` property which you can use to look up the task
later.

Examples
^^^^^^^^

- Refresh all device parameters now:

.. code:: bash

  curl -i 'http://localhost:7557/devices/202BC1-BM632w-0000000/tasks?connection_request' \
  -X POST \
  --data '{"name": "refreshObject", "objectName": ""}'

- Change WiFi SSID and password:

.. code:: javascript

  {
    "name": "setParameterValues",
    "parameterValues": [
      ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", "GenieACS", "xsd:string"],
      ["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey", "hello world", "xsd:string"]
    ]
  }

.. code:: bash

  curl -i 'http://localhost:7557/devices/202BC1-BM632w-0000000/tasks?connection_request' \
  -X POST \
  --data '{"name":"setParameterValues", "parameterValues": [["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID", "GenieACS", "xsd:string"],["InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.PreSharedKey", "hello world", "xsd:string"]]}'

POST /tasks/\<task_id\>/retry
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Retry a faulty task at the next inform.

*task_id*: The ID of the task as returned by 'GET /tasks' request.

Example
^^^^^^^

.. code:: bash

  curl -i 'http://localhost:7557/tasks/5403908ef28ea3a25c138adc/retry' -X POST

DELETE /tasks/\<task_id\>
~~~~~~~~~~~~~~~~~~~~~~~~~

Delete the given task.

*task_id*: The ID of the task as returned by 'GET /tasks' request.

Example
^^^^^^^

.. code:: bash

  curl -i 'http://localhost:7557/tasks/5403908ef28ea3a25c138adc' -X DELETE

DELETE /faults/\<fault_id\>
~~~~~~~~~~~~~~~~~~~~~~~~~~~

Delete the given fault.

*fault_id*: The ID of the fault as returned by 'GET /faults' request. The ID
format is "\<device_id\>:\<channel\>".

Example
^^^^^^^

.. code:: bash

  curl -i 'http://localhost:7557/faults/202BC1-BM632w-0000000:default' -X DELETE

DELETE /devices/\<device_id\>
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Delete the given device from the database.

Example
^^^^^^^

.. code:: bash

  curl -X DELETE -i 'http://localhost:7557/devices/202BC1-BM632w-000001'

.. note::

  Note that the device will be registered again when/if it contacts the ACS
  again (e.g. on the next periodic inform).

POST /devices/\<device_id\>/tags/\<tag\>
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Assign a tag to a device. Has no effect if such tag already exists.

*device_id*: The ID of the device.

*tag*: The tag to be assigned.

Example
^^^^^^^

Assign the tag "testing" to a device:

.. code:: bash

  curl -i 'http://localhost:7557/devices/202BC1-BM632w-0000000/tags/testing' -X POST

DELETE /devices/\<device_id\>/tags/\<tag\>
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Remove a tag from a device.

*device_id*: The ID of the device.

*tag*: The tag to be removed.

Example
^^^^^^^

Remove the tag "testing" from a device:

.. code:: bash

  curl -i 'http://localhost:7557/devices/202BC1-BM632w-0000000/tags/testing' -X DELETE

PUT /presets/\<preset_name\>
~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Create or update a preset. Returns status code 200 if the preset has been
added/updated successfully. The body of the request is a JSON representation of
the preset. Refer to :ref:`presets` section below for details about its format.

*preset_name*: The name of the preset.

Example
^^^^^^^

Create a preset to set 5 minutes inform interval for all devices tagged with
"test":

.. code:: javascript

  query = {
    "weight": 0,
    "precondition": "{\"_tags\": \"test\"}"
    "configurations": [
      {
        "type": "value",
        "name": "InternetGatewayDevice.ManagementServer.PeriodicInformEnable",
        "value": "true"
      },
      {
        "type": "value",
        "name": "InternetGatewayDevice.ManagementServer.PeriodicInformInterval",
        "value": "300"
      }
    ]
  }

.. code:: bash

  curl -i 'http://localhost:7557/presets/inform' \
  -X PUT \
  --data '{"weight": 0, "precondition": "{\"_tags\": \"test\"}", "configurations": [{"type": "value", "name": "InternetGatewayDevice.ManagementServer.PeriodicInformEnable", "value": "true"}, {"type": "value", "name": "InternetGatewayDevice.ManagementServer.PeriodicInformInterval", "value": "300"}]}'

DELETE /presets/\<preset_name\>
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. code:: bash

	curl -i 'http://localhost:7557/presets/inform' -X DELETE

PUT /files/\<file_name\>
~~~~~~~~~~~~~~~~~~~~~~~~

Upload a new file or overwrite an existing one. Returns status code 200 if the
file has been added/updated successfully. The file content should be sent as
the request body.

*file_name*: The name of the uploaded file.

The following file metadata may be sent as request headers:

- ``fileType``: For firmware images it should be "1 Firmware Upgrade Image".
  Other common types are "2 Web Content" and "3 Vendor Configuration File".

- ``oui``: The OUI of the device model that this file belogs to.

- ``productClass``: The product class of the device.

- ``version``: In case of firmware images, this refer to the firmware version.

Example
^^^^^^^

Upload a firmware image file:

.. code:: bash

  curl -i 'http://localhost:7557/files/new_firmware_v1.0.bin' \
  -X PUT \
  --data-binary @"./new_firmware_v1.0.bin" \
  --header "fileType: 1 Firmware Upgrade Image" \
  --header "oui: 123456" \
  --header "productClass: ABC" \
  --header "version: 1.0"

DELETE /files/\<file_name\>
~~~~~~~~~~~~~~~~~~~~~~~~~~~

Delete a previously uploaded file:

.. code:: bash

	curl -i 'http://localhost:7557/files/new_firmware_v1.0.bin' -X DELETE

GET /files/
~~~~~~~~~~~

Gets all previously uploaded files.

GET /files/?query={"filename":"\<filename\>"}
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Find files using a query.

.. _tasks:

Tasks
-----

Find the different availabe tasks and their object structure.

``getParameterValues``
~~~~~~~~~~~~~~~~~~~~~~

.. code:: javascript

  query = {
    "name": "getParameterValues",
    "parameterNames": [
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnectionNumberOfEntries",
      "InternetGatewayDevice.Time.NTPServer1", "InternetGatewayDevice.Time.Status"
    ]
  }

.. code:: bash

  curl -i 'http://localhost:7557/devices/00236a-96318REF-SR360NA0A4%252D0003196/tasks?timeout=3000&connection_request' \
  -X POST \
  --data '{"name": "getParameterValues", "parameterNames": ["InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnectionNumberOfEntries", "InternetGatewayDevice.Time.NTPServer1", "InternetGatewayDevice.Time.Status"] }'

You may request a single or multiple parameters at once.

After the task has been executed successfully you can then fetch the CPE object
and read the parameters from the JSON object.

.. code:: javascript

  query = {"_id": "00236a-96318REF-SR360NA0A4%2D0003196"}

.. code:: bash

  curl -i 'http://localhost:7557/devices/?query=%7B%22_id%22%3A%2200236a-96318REF-SR360NA0A4%252D0003196%22%7D'

``refreshObject``
~~~~~~~~~~~~~~~~~

.. code:: bash

  curl -i 'http://localhost:7557/devices/00236a-SR552n-SR552NA084%252D0003269/tasks?timeout=3000&connection_request' \
  -X POST \
  --data '{"name": "refreshObject", "objectName": "InternetGatewayDevice.WANDevice.1.WANConnectionDevice"}'

``setParameterValues``
~~~~~~~~~~~~~~~~~~~~~~

.. code:: bash

  curl -i 'http://localhost:7557/devices/00236a-SR552n-SR552NA084%252D0003269/tasks?timeout=3000&connection_request' \
  -X POST \
  --data '{"name": "setParameterValues", "parameterValues": [["InternetGatewayDevice.ManagementServer.UpgradesManaged",false]]}'

Multiple values can be set at once by adding multiple arrays to the
parameterValues key. For example:

.. code:: javascript

  {
    name: "setParameterValues",
    parameterValues: [["InternetGatewayDevice.ManagementServer.UpgradesManaged", false], ["InternetGatewayDevice.Time.Enable", true], ["InternetGatewayDevice.Time.NTPServer1", "pool.ntp.org"]]
  }

``addObject``
~~~~~~~~~~~~~

.. code:: bash

  curl -i 'http://localhost:7557/devices/00236a-SR552n-SR552NA084%252D0003269/tasks?timeout=3000&connection_request' \
  -X POST \
  --data '{"name":"addObject","objectName":"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection"}'

``deleteObject``
~~~~~~~~~~~~~~~~

.. code:: bash

  curl -i 'http://localhost:7557/devices/00236a-SR552n-SR552NA084%252D0003269/tasks?timeout=3000&connection_request' \
  -X POST \
  --data '{"name":"deleteObject","objectName":"InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANPPPConnection.1"}'

``reboot``
~~~~~~~~~~

.. code:: bash

  curl -i 'http://localhost:7557/devices/00236a-SR552n-SR552NA084%252D0003269/tasks?timeout=3000&connection_request' \
  -X POST \
  --data '{"name": "reboot"}'

``factoryReset``
~~~~~~~~~~~~~~~~

.. code:: bash

  curl -i 'http://localhost:7557/devices/00236a-SR552n-SR552NA084%252D0003269/tasks?timeout=3000&connection_request' \
  -X POST \
  --data '{"name": "factoryReset"}'

``download``
~~~~~~~~~~~~

.. code:: bash

  curl -i 'http://localhost:7557/devices/00236a-SR552n-SR552NA084%252D0003269/tasks?timeout=3000&connection_request' \
  -X POST \
  --data '{"name": "download", "file": "mipsbe-6-42-lite.xml"}'

.. _presets:

Presets
-------

Presets assign a set of configuration or a Provision script to devices based on
a precondition (search filter), schedule (cron expression), and events.

Precondition
~~~~~~~~~~~~

The ``precondition`` property is a JSON string representation of the search
filter to test if the preset applies to a given device. Examples preconditions
are:

- ``{"param": "value"}``
- ``{"param": value", "param2": {"$ne": "value2"}}``

Other operators that can be used are ``$gt``, ``$lt``, ``$gte`` and ``$lte``.

Configuration
~~~~~~~~~~~~~

The configuration property is an array containing the different configurations
to be applied to a device, as shown below:

.. code:: javascript

  [
    {
      "type": "value",
      "name": "InternetGatewayDevice.ManagementServer.PeriodicInformEnable",
      "value": "true"
    },
    {
      "type": "value",
      "name": "InternetGatewayDevice.ManagementServer.PeriodicInformInterval",
      "value": "300"
    },
    {
      "type": "delete_object",
      "name": "object_parent",
      "object": "object_name"
    },
    {
      "type": "add_object",
      "name": "object_parent",
      "object": "object_name"
    },
    {
      "type": "provision",
      "name": "YourProvisionName"
    },
  ] 

The configuration type ``provision`` triggers a Provision script. In the
example above, the provision named "YourProvisionName" will be executed.

Provisions
----------

Create a provision
~~~~~~~~~~~~~~~~~~

The Provision's JavaScript code is the body of the HTTP PUT request.

.. code:: bash

  curl -X PUT -i 'http://localhost:7557/provisions/mynewprovision' --data 'log("Provision started at " + now);'

Delete a provision
~~~~~~~~~~~~~~~~~~

.. code:: bash

  curl -X DELETE -i 'http://localhost:7557/provisions/mynewprovision'

Get provisions
~~~~~~~~~~~~~~

Get all provisions:

.. code:: bash

  curl -X GET -i 'http://localhost:7557/provisions/'
