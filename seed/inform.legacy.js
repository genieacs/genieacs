// Device ID as user name
const username = declare("DeviceID.ID", { value: 1 }).value[0];

// Password will be fixed for a given device because Math.random() is seeded with device ID by default.
const password = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER).toString(
  36,
);

const informInterval = 300;

// Refresh values daily
const daily = Date.now(86400000);

// Unique inform offset per device for better load distribution
const informTime = daily % 86400000;

declare(
  "InternetGatewayDevice.ManagementServer.ConnectionRequestUsername",
  { value: daily },
  { value: username },
);
declare(
  "InternetGatewayDevice.ManagementServer.ConnectionRequestPassword",
  { value: daily },
  { value: password },
);
declare(
  "InternetGatewayDevice.ManagementServer.PeriodicInformEnable",
  { value: daily },
  { value: true },
);
declare(
  "InternetGatewayDevice.ManagementServer.PeriodicInformInterval",
  { value: daily },
  { value: informInterval },
);
declare(
  "InternetGatewayDevice.ManagementServer.PeriodicInformTime",
  { value: daily },
  { value: informTime },
);

declare(
  "Device.ManagementServer.ConnectionRequestUsername",
  { value: daily },
  { value: username },
);
declare(
  "Device.ManagementServer.ConnectionRequestPassword",
  { value: daily },
  { value: password },
);
declare(
  "Device.ManagementServer.PeriodicInformEnable",
  { value: daily },
  { value: true },
);
declare(
  "Device.ManagementServer.PeriodicInformInterval",
  { value: daily },
  { value: informInterval },
);
declare(
  "Device.ManagementServer.PeriodicInformTime",
  { value: daily },
  { value: informTime },
);
