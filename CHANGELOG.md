# Change Log

## 1.2.0-beta.0 (2019-07-30)

- A brand new UI superseding genieacs-gui.
- New initialization wizard on first run.
- New expression/query language used in search filters and preset
preconditions.
- CPE -> ACS authentication is now supported.
- New config option (CWMP_KEEP_ALIVE_TIMEOUT) to specify how long to wait for a
reply from the CPE before closing the TCP connection.
- Debug logging has been reimplemented utilizing YAML format for logs.
- Handle 9005 faults (Invalid Parameter Name) gracefully by attempting to
rediscover the path of the missing parameter recursively.
- declare() statements not followed by an explicit commit() are now deferred
until all currently active scripts have been executed.
- FS_HOSTNAME now defaults to the server's hostname or IP.
- The API now validates the structure of task objects before saving.
- New XML parser implementation for better performance. You can revert to the
old parser by enabling the config option XML_LIBXMLJS. Requires Node.js v11 or
v10.
- Performance optimizations. While performance has improved for the majority of
use cases, there may be situations where performance has degraded. It's
recommended to revisit your hardware requirements.
- Connection request authentication no longer uses 'auth.js' file. Instead, the
connection request authentication behavior can now be customized using an
'expression'.
- The config file (config.json) has been deprecated. System configuration (e.g.
listen ports, worker count) are now recommended to be passed as environment.
variables. Other general configuration options are stored in the database so as
to not require service restart for changes to take effect.
- Optional redis dependency has been removed completely.
- Tags now allow only alphanumeric characters and underscore.
- Supported versions of NodeJs and MongoDB are 10.x and up and 2.6 and up
respectively.

## 1.1.3 (2018-10-23)

- New config option (MAX_COMMIT_ITERATIONS) to avoid max commit iterations
faults for more complex scripts.
- Support base64 and hexBinary parameter types.
- Strict parsing of number values in queries (e.g. "123abc" no longer accepted
as 123).
- Mixing $ne and $not operators is not allowed. Now it throws an error instead
of returning incorrect results.
- When a task expires, any associated fault is also deleted.
- API now accepts 'timeout' argument when posting a task.
- A number of stability fixes.

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
