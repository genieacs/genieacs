# Change Log

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
