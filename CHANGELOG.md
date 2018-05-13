# Change Log

## 1.1.2 (2018-02-24)

- A large number of bug fixes as well as stability and performance improvements.
- Three security vulnerabilities disclosed by Maximilian Hils have been patched.
- New config option UDP_CONNECTION_REQUEST_PORT to specify binding port for UDP
connection requests.
- New config option DATETIME_MILLISECONDS to strip milliseconds from dateTime
values.
- New config option BOOLEAN_LITERAL to use 1/0 or true/false for boolean values.
- Parameter values that cannot be parsed according to the reported type now show
a warning message.
- Virtual parameter scripts now use the variable 'args' instead of the special
'TIMESTAMPS' and 'VALUES' variables. The content of the args array is: {declare
timestamps}, {declare values}, {current timestamps}, {current values}.
- Virtual parameter value types are now inferred from the JavaScript type if the
returned value attribute is not a value-type pair.
- Show a fault when a virtual parameter script doesn't return the required
attributes.
- Redis is now optional (and disabled by default), reducing the complexity of
scalable deployments.
- Better detection of cyclical presets resulting in fewer faults for complex
provisioning scripts.
- Math.random() is now deterministic on per-device basis. A function has been
added to allow specifying a seed value (e.g. Math.random.seed(Date.now())).
- Overload spikes are now handled gracefully by refusing to accept new sessions
temporarily when under abnormal load.
- Added log messages for session timeouts, connection drops, and XML parsing
errors.
- Date.now() now takes an optional argument to specify "time steps" (in
milliseconds). This can be used to ensure a group of parameters are all
refreshed at the same time intervals.
- Only the non-default configuration options are now logged at process start.
- Faults caused by errors from extensions now show a cleaner stack trace.
- Exit main process if there are too many worker crashes (e.g. when DB is down).
- Updated dependencies and included a lockfile to ensure installations get the
exact dependencies it was tested against.

## 1.1.1 (2017-03-23)

- Avoid crashing when connection request credentials are missing.
- Show a warning instead of crashing when failing to parse parameter values
according to the expected value type.
- Add missing "Registered" event.
- Fix bug where in certain cases many more instances than declared are created.
- Fix parameter discovery bug when declared path timestamp is 1 or is not set.
- Fix preset precondition failing when testing against datetime parameters and
certain other parameters like \_deviceId.\_ProductClass.

## 1.1.0 (2017-03-10)

- Provisions enable implementing dynamic device configuration or complex device
provisioning work flow using arbitrary scripts.
- Virtual parameters are user-defined parameters whose values are evaluated from
a custom script.
- Extensions are sandboxed Node.js scripts that are accessible from provision
and virtual parameter scripts to facilitate integration with external entities.
- Support for UDP/STUN based connection requests for reaching devices behind
NAT (TR-069 Annex G).
- Presets can now be scheduled using a cron-like expression.
- Presets can now be tied to specific device events (e.g. boot).
- Presets precondition queries no longer support "$or" or other MongoDB logical
operators.
- Faults are no longer a part of tasks but are now first class objects.
- Presets are now assigned to channels. A fault in one channel only blocks
presets in that channel.
- New API CRUD functions for provisions, virtual parameters, and faults.
- New config options for XML output.
- API responses now include "GenieACS-Version" header.
- Graceful shutdown when receiving SIGINT and SIGTERM events.
- Support SSL intermediate certificate chains.
- Supported Node.js versions are 6.x and 7.x.
- Supported MongoDB versions are 2.6 through 3.4.
- Expect performance differences due to major under the hood changes. Some
operations are faster and some are slower. Overall performance is improved.
- GenieACS will no longer fetch the entire device data model upon first contact
but will instead only fetch the parameters it needs to fulfill the presets.
- Logs have been overhauled and split into two streams: process log (stderr) and
access log (stdout). Also added config options to dump logs to files rather than
standard streams.
- Connection request authentication credentials are picked up from the device
data model if available. config/auth.js is still supported as a fallback and now
supports an optional callback argument.
- Custom commands have been removed. Use virtual parameters and/or extensions.
- Aliases and value normalizers (config/parameters.json) have been removed. Use
virtual parameters.
- The API /devices/<device_id>/preset has been removed.
- Rarely used RequestDownload method no longer supported.
- The TR-069 client simulator has moved to its own repo at
https://github.com/zaidka/genieacs-sim
