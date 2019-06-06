.. _extensions:

Extensions
==========

Given that :ref:`provisions` and :ref:`virtual-parameters` are executed in a
sandbox environment, it is not possible to interact with external sources or
execute any action that requires OS, file system, or network access. Extensions
exist to bridge that gap.

Extensions are fully-privileged Node.js modules and as such have access to
standard Node libraries and 3rd party packages. Functions exposed by the
extension can be called from Provision scripts using the ``ext()`` function. A
typical use case for extensions is fetching credentials from a database to have
that pushed to the device during provisioning.

By default, the extension JS code must be placed under ``config/ext``
directory. You may need to create that directory if it doesn't already exist.

The example extension below fetches data from an external REST API and returns
that to the caller:

.. literalinclude:: ext-sample.js
  :language: javascript

To call this extension from a Provision or a Virtual Parameter script:

.. code:: javascript

  // The arguments "arg1" and "arg2" are passed to the latlong. Though they are
  // unused in this particular example.
  const res = ext("ext-sample", "latlong", "arg1", "arg2");
  log(JSON.stringify(res));
