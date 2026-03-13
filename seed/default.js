const hourly = Date.now(3600000);

// Refresh basic parameters hourly
declare("InternetGatewayDevice.DeviceInfo.HardwareVersion", {
  path: hourly,
  value: hourly,
});
declare("InternetGatewayDevice.DeviceInfo.SoftwareVersion", {
  path: hourly,
  value: hourly,
});
declare(
  "InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.MACAddress",
  { path: hourly, value: hourly },
);
declare(
  "InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.ExternalIPAddress",
  { path: hourly, value: hourly },
);
declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.SSID", {
  path: hourly,
  value: hourly,
});
// Don't refresh password field periodically because CPEs always report blank passowrds for security reasons
declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.KeyPassphrase", {
  path: hourly,
  value: 1,
});
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.HostName", {
  path: hourly,
  value: hourly,
});
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.IPAddress", {
  path: hourly,
  value: hourly,
});
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.MACAddress", {
  path: hourly,
  value: hourly,
});
