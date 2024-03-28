# Change Log

## 1.2.12 (2024-03-28)

- Fix broken XMPP support in the previous release.

- Fix regression causing CSV downloads to be buffered in memory before being
  streamed to the client.

## 1.2.11 (2024-03-21)

- Resolved an issue from the previous release that caused incompatibility with
  Node.js versions 12 through 15.

## 1.2.10 (2024-03-18)

- Add support for XMPP connection requests. Use the environment variables
  `XMPP_JID` and `XMPP_PASSWORD` to configure the XMPP connection for the ACS.

- The environment variables `CWMP_SSL_CERT` and `CWMP_SSL_KEY`, as well as their
  counterparts for UI, NBI, and FS, now accept PEM-encoded certificates and keys
  in addition to file paths.

- The UI no longer requires users to refresh the page after modifying presets,
  provisions, or virtual parameters. Refreshing is now only necessary for
  changes to users, permissions, or UI configurations.

- Improved conversion of GenieACS expressions into MongoDB queries for more
  optimized queries and better index utilization.

- Refactor UI pagination and sorting to fix issues from the previous approach,
  especially with sorting by rapidly changing parameters such as 'last inform'
  time.

- The file server now supports HEAD requests, the Range header, and conditional
  requests.

- Addressed an issue causing file server disconnections for slow clients over
  HTTPS.

- Fix bug preventing users from changing their own passwords.

- Introduced a new 'locks' collection for database locking, replacing the
  previous use of the 'cache' collection for this purpose.

- Various other minor fixes and enhancements.

## 1.2.9 (2022-08-22)

- New config option `cwmp.skipRootGpn` to enable a workaround for some
  problematic CPEs that reject GPN requests on data model root.
- Stream query results and CSV downloads as data becomes available instead of
  buffering the entire response.
- Log HTTP/HTTPS client errors in debug log.
- Fix occasional lock expired errors after updating presets, etc.
- Fix bug where queries containing `<>` operator may return incorrect results.
- Fix a performance hit caused by DB calls containing the entire CPE data model
  rather then just the updated parameters.
- Fix bug where tags containing special characters are saved in their encoded
  form when set via a Provision script.
- Fix issue causing invalid `xsd:dateTime` values to be saved in DB as `NaN`
  rather than maintain the original string value.
- Fix bug using `$regex` operator with a numeric or a datetime string.
- Fix ping not working on certain platforms.
- Ping requests are now authenticated.
- Fix error when the `FORWARDED_HEADER` environment variable contains IPv4 CIDR
  while the listening interface is IPv6 and vice versa.
- Fix false warning "unexpected parameter in response" showing in
  `genieacs-cwmp` logs.
- Other minor fixes and stability improvements.

## 1.2.8 (2021-10-27)

- Fix a remote code execution security vulnerability in genieacs-ui.
- All UI components can now be configured using fully dynamic expressions.
  Previously some component types only accept fixed string values as properties.
- The `container` UI component can now be configured with an `element` property
  that's either a string or a nested pair of `tag` and `attributes` properties.
  The various attributes under the `attributes` property can now make use of a
  new function `ENCODEURICOMPONENT()` to facilitate creating custom hyperlinks
  in the UI.
- Improve sorting buttons' behavior in the device listing page and other pages.
  Sorting by multiple columns should now feel more intuitive.
- Support the modulo (%) operator in expressions.
- Fix a regression in the previous release where the config option 'ui.pageSize'
  no longer works.
- Fix process crash when a CPE sends an unsupported ACS method.

## 1.2.7 (2021-09-18)

- Fix regression causing frequent invalid session errors.
- Fix regression breaking digest authentication in connection requests.

## 1.2.6 (2021-09-16)

- New config option `cwmp.downloadSuccessOnTimeout` to enable a workaround for
  CPEs that neglect to send a TransferComplete message after a successful
  download.
- Display a progress bar when uploading new files.
- Default to dual stack interface binding (i.e. `::` instead of `0.0.0.0`).
  Unless the binding interface is explicitly set, this will cause IPv4 addresses
  in the logs to be displayed as IPv4-mapped IPv6 addresses (e.g.
  `::ffff:127.0.0.1` instead of `127.0.0.1`).
- Detect and correct for client side (browser) clock skew that would otherwise
  alter the numbers in the pie charts.
- Various improvements relating to dealing with buggy TR-069 client
  implementations.
- Fix a bug causing "lock expired" exceptions when a CWMP session remains open
  for a very long time due to slow clients.
- Fix metadata of uploaded files going missing due to nginx stripping away what
  it considers to be invalid headers. The nginx directive
  `ignore_invalid_headers` is no longer required.
- Fix crash when a CPE is assigned a tag containing a dot.
- Fix bug preventing the user from closing the preset pop-up after being
  presented with unsupported preset message.
- Fix exceptions raised from ext scripts manifesting as timeout faults.
- Fix download getting triggered repeatedly when the value passed to `Download`
  parameter is greater than the current timestamp.
- Fix crash when passing invalid attributes to `declare`.
- Fix crash in NBI when pushing tasks to non-existing devices.
- Fix crash in NBI when passing invalid JSON to various API endpoints.
- Fix crash when the output from `ping` command cannot be parsed in some rare
  edge cases.
- A number of other fixes and stability improvements.

## 1.2.5 (2021-03-12)

- Support specifying custom types when uploading files.
- Fix JS compatibility issue with Safari browser.

## 1.2.4 (2021-02-24)

- The data model state of a CPE is no longer forgotten after unsuccessful
  session termination (e.g. timeout). This addresses a number of undesired side
  effects that arise when a CPE does not terminate the session properly.
- Executing tasks that take a long time to complete (e.g. refreshing the entire
  data model) no longer shows a timeout error while the task is still being
  processed.
- New function `ROUND()` available to expressions. It works similar to the
  function by the same name in SQLite and PostgreSQL.
- Log access events for `genieacs-nbi` service.
- Pipe stdout/stderr from extension scripts to the `genieacs-cwmp` process log.
- Parameter values of type `xsd:dateTime` are now displayed in the UI and CSV
  downloads as a date string rather than a numeric value.
- Add file download link in the files listing page.
- Display spinner loading animation throughout the UI.
- Display GenieACS version and build number underneath the logo.
- New option to specify how many parameters are displayed at a time in the
  all-parameters component. Simply set `limit` property in the component config.
- Reduce overly strong Brotli compression level which was causing significant
  page load slowdown when Brotli is used.
- Retire dump-data-model tool. `genieacs-sim` can now use a CSV file as its data
  model.
- Reduce the number of concurrent database connections from each process.
- Remove dependency on 'hostInfo' MongoDB command which is a privileged action.
  It is now possible to use shared MongoDB instances with limited privileged.
- Fix bug in NBI where querying files returns 404 error.
- Fix ping not working for devices with an IPv6 address.
- Fix an elusive memory leak in `genieacs-fs` that slowly eats up memory and can
  go unnoticed for long periods of time.
- Fix a rare edge case where a `declare()` call to set a parameter value may not
  work as intended if the parameter was originally received as part of the
  Inform message.
- A number of other fixes and stability improvements.

## 1.2.3 (2020-10-26)

- New config option 'cwmp.skipWritableCheck' for when some CPEs incorrectly
  report writable parameters as non-writable. When set to true, the scripts will
  no longer respect the 'writable' attribute of the CPE parameters and will send
  a SetParamteerValues, AddObject, or DeleteObject request anyway.
- Tags no longer restrict what characters are allowed. Any character other than
  alphanumeric characters, hyphen, or underscore is now encoded in the data
  model (i.e. Tags.\<tag>) using its hex value preceded by "0x".
- Ask for a confirmation before closing a pop-up dialog with unsaved changes.
- Better XML validation to avoid crashes caused by invalid CPE requests.
- Fix confusing 404 error message when the user attempts to modify a resource
  when they don't have the necessary permissions.
- Fix a rare issue where genieacs-cwmp stops accepting new connections after
  running for a few weeks.
- Fix exception when IS NULL operator is used in certain situations.

## 1.2.2 (2020-10-03)

- Added button to push files to selected devices from device listing page.
- A few minor UI improvements.
- Fix exception that can happen and persist after a Download request.
- Fix validation bug preventing running refreshObject task on data model root.
- Fix invalid arguments fault in refresh preset configuration when upgrading
  from v1.1.

## 1.2.1 (2020-09-08)

- Fix bug causing faults to not be displayed in the UI.
- Fix bug where deleting objects does not get reflected immediately in the UI.
- Improve conversion between filters written in the expression format and
  MongoDB queries. There should now be fewer edge cases where the two are not
  equisatisfiable.

## 1.2.0 (2020-09-01)

- Support GetParameterAttributes and SetParameterAttributes TR-069 methods.
- Support CASE statement and COALESCE function in expressions.
- Provision arguments can now be a list of expressions that are dynamically
  evaluated.
- Support Forwarded HTTP header to display in the logs the correct IP of CPEs
  behind a reverse proxy. Must be configured using FORWARDED_HEADER option.
- Config expressions can now access all available device parameters, not only
  serial number, product class, and OUI.
- Use relative URLs throughout the UI to allow serving from a subdirectory using
  a reverse proxy.
- Make Date.parse() and Date.UTC() available to provision scripts.
- libxmljs has been entirely removed in favor of our bespoke XML parser.
- Removed the config option CWMP_KEEP_ALIVE_TIMEOUT. SESSION_TIMEOUT is now used
  to determine the TCP connection timeout.
- The all-parameters component now limits the number of parameters displayed for
  better performance.
- The process genieacs-cwmp is now much less likely to throw exceptions as a
  result of invalid requests from CPE.
- A large number of bug fixes and stability improvements.

## 1.2.0-beta.0 (2019-07-30)

- A brand new UI superseding genieacs-gui.
- New initialization wizard on first run.
- New expression/query language used in search filters and preset preconditions.
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
  variables. Other general configuration options are stored in the database so
  as to not require service restart for changes to take effect.
- Optional redis dependency has been removed completely.
- Tags now allow only alphanumeric characters and underscore.
- Supported versions of Node.js and MongoDB are 10.x and up and 2.6 and up
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
  'TIMESTAMPS' and 'VALUES' variables. The content of the args array is:
  {declare timestamps}, {declare values}, {current timestamps}, {current
  values}.
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
  and virtual parameter scripts to facilitate integration with external
  entities.
- Support for UDP/STUN based connection requests for reaching devices behind NAT
  (TR-069 Annex G).
- Presets can now be scheduled using a cron-like expression.
- Presets can now be tied to specific device events (e.g. boot).
- Presets precondition queries no longer support "\$or" or other MongoDB logical
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
  access log (stdout). Also added config options to dump logs to files rather
  than standard streams.
- Connection request authentication credentials are picked up from the device
  data model if available. config/auth.js is still supported as a fallback and
  now supports an optional callback argument.
- Custom commands have been removed. Use virtual parameters and/or extensions.
- Aliases and value normalizers (config/parameters.json) have been removed. Use
  virtual parameters.
- The API /devices/<device_id>/preset has been removed.
- Rarely used RequestDownload method no longer supported.
- The TR-069 client simulator has moved to its own repo at
  https://github.com/zaidka/genieacs-sim
