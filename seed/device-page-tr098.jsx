// Device page for TR-098 (InternetGatewayDevice) data model.
//
// Displays device information, parameters, LAN hosts, faults, and data model.
// Customize the 'parameters' array below to change displayed fields.
//
// Attributes:
//   device - Device object from the parent router

const device = node.attributes.device.get();
const deviceId = device["DeviceID.ID"];
const taskCmd = new Signal.State(null);
const deviceFaults = new Signal.State(null);
const delCmd = new Signal.State(null);
const delStatus = new Signal.State(null);

const delMessage = new Signal.Computed(() => {
  const s = delStatus.get();
  if (s === true) return { type: "success", message: "Deleted successfully" };
  if (s instanceof Error) return { type: "error", message: s.message };
  return null;
});

const pingResult = new Signal.State(null);
const pingDisplay = new Signal.Computed(() => {
  const r = pingResult.get();
  if (r == null) return null;
  if (r instanceof Error) return "Error!";
  if (typeof r === "number") return `${Math.trunc(r)} ms`;
  return "Unreachable";
});

const connectionUrl =
  device["InternetGatewayDevice.ManagementServer.ConnectionRequestURL"];
const hostIp = connectionUrl ? new URL(connectionUrl).hostname : null;

// Device parameters to display
const parameters = [
  { label: "Serial number", param: "DeviceID.SerialNumber" },
  { label: "Product class", param: "DeviceID.ProductClass" },
  { label: "OUI", param: "DeviceID.OUI" },
  { label: "Manufacturer", param: "DeviceID.Manufacturer" },
  {
    label: "Hardware version",
    param: "InternetGatewayDevice.DeviceInfo.HardwareVersion",
  },
  {
    label: "Software version",
    param: "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
  },
  {
    label: "MAC",
    param:
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress",
  },
  {
    label: "IP",
    param:
      "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
  },
  {
    label: "WLAN SSID",
    param: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
  },
  {
    label: "WLAN passphrase",
    param:
      "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.PreSharedKey.1.KeyPassphrase",
  },
];

const hostsRoot = "InternetGatewayDevice.LANDevice.1.Hosts.Host";
const hostsColumns = [
  { label: "Host name", param: "HostName" },
  { label: "IP", param: "IPAddress" },
  { label: "MAC", param: "MACAddress" },
];

// Parameters to refresh when summoning the device
const summonParams = [
  ...parameters.map((p) => p.param).filter((p) => !p.startsWith("DeviceID.")),
  ...hostsColumns.map((c) => `${hostsRoot}.*.${c.param}`),
];

const parameterRows = parameters
  .filter(({ param }) => device[param])
  .map(({ label, param }) => (
    <tr class="border-b border-stone-200">
      <th class="text-sm font-medium text-stone-500 text-left px-6 py-3">
        {label}
      </th>
      <td class="text-sm text-stone-900 px-6 py-3">
        <parameter device={device} param={param} />
      </td>
    </tr>
  ));

const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_DAY = 24 * 60 * 60 * 1000;

const informTime = device["Events.Inform"];
const now = Date.now();
const [onlineStatus, statusColor] =
  informTime > now - FIVE_MINUTES
    ? ["Online", "#31a354"]
    : informTime > now - FIVE_MINUTES - ONE_DAY
      ? ["Past 24 Hours", "#a1d99b"]
      : ["Others", "#e5f5e0"];

const faultsTable = new Signal.Computed(() => {
  const faults = deviceFaults.get();
  if (!faults?.length)
    return (
      <tr>
        <td
          class="bg-stripes text-sm font-medium text-center text-stone-500 p-4"
          colspan="7"
        >
          No faults
        </td>
      </tr>
    );
  return faults.map((f) => {
    const yamlOut = new Signal.State("");
    return (
      <tr key={f._id}>
        <td class="whitespace-nowrap pl-6 pr-3 py-4 text-sm text-stone-900">
          {f.channel}
        </td>
        <td class="whitespace-nowrap px-3 py-4 text-sm text-stone-900">
          {f.code}
        </td>
        <td class="whitespace-nowrap px-3 py-4 text-sm text-stone-900">
          <span
            class="inline-block truncate decoration-dotted max-w-xs"
            onmouseover={(e) => {
              e.target.title = f.message;
            }}
          >
            {f.message}
          </span>
        </td>
        <td class="whitespace-nowrap px-3 py-4 text-sm text-stone-900">
          <do-yaml-stringify arg={f.detail} res={yamlOut} />
          <span
            class="inline-block truncate decoration-dotted max-w-xs cursor-pointer hover:underline"
            onmouseover={(e) => {
              e.target.title = e.target.textContent;
            }}
          >
            {yamlOut}
          </span>
        </td>
        <td class="whitespace-nowrap px-3 py-4 text-sm text-stone-900">
          {f.retries}
        </td>
        <td class="whitespace-nowrap px-3 py-4 text-sm text-stone-900">
          {new Date(f.timestamp).toLocaleString()}
        </td>
        <td class="whitespace-nowrap px-3 py-4 text-sm text-stone-900">
          <button
            class="text-cyan-700 hover:text-cyan-900 font-medium"
            onclick={() => delCmd.set({ resource: "faults", id: f._id })}
          >
            Delete
          </button>
        </td>
      </tr>
    );
  });
});

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    <do-task arg={taskCmd} />
    <do-delete arg={delCmd} res={delStatus} />
    <do-notify arg={delMessage} />
    <div class="device-page">
      <h1>{deviceId}</h1>
      <tags device={device} writable={true} />
      <do-ping arg={hostIp} res={pingResult} />
      <div class="text-sm my-4 px-1">
        <span class="font-medium text-stone-500">Pinging {hostIp}: </span>
        {pingDisplay}
      </div>
      <table class="table-auto bg-white shadow rounded-lg divide-y divide-stone-200 w-max">
        <tbody>
          <tr class="border-b border-stone-200">
            <th class="text-sm font-medium text-stone-500 text-left px-6 py-3">
              Last inform
            </th>
            <td class="text-sm text-stone-900 px-6 py-3">
              <span class="inform">
                <parameter device={device} param="Events.Inform" />
                <svg
                  class="inline"
                  width="1em"
                  height="1em"
                  style="margin: 0 0.2em 0.2em"
                >
                  <circle
                    class="stroke-stone-200 stroke-1"
                    cx="0.5em"
                    cy="0.5em"
                    r="0.4em"
                    fill={statusColor}
                  />
                </svg>
                {onlineStatus}
                <summon-button deviceId={deviceId} params={summonParams} />
              </span>
            </td>
          </tr>
          {parameterRows}
        </tbody>
      </table>
      <h2>LAN Hosts</h2>
      <instance-table root={hostsRoot} device={device}>
        {hostsColumns.map((c) => (
          <param label={c.label} param={c.param} />
        ))}
      </instance-table>
      <do-fetch
        arg={{
          resource: "faults",
          filter: `_id > '${deviceId}:' AND _id < '${deviceId}:\xff'`,
        }}
        res={deviceFaults}
      />
      <h2>Faults</h2>
      <div class="shadow overflow-hidden rounded-lg w-max">
        <table class="divide-y divide-stone-200">
          <thead class="bg-stone-50">
            <tr>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 pl-6 pr-3">
                Channel
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                Code
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                Message
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                Detail
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                Retries
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3">
                Timestamp
              </th>
              <th class="py-3.5 text-left text-sm font-semibold text-stone-500 px-3"></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-stone-200 bg-white">
            {faultsTable}
          </tbody>
        </table>
      </div>
      <h2>Data model</h2>
      <datamodel-explorer device={device} />
      <div class="space-x-3 mt-4">
        {[
          {
            label: "Reboot",
            title: "Reboot device",
            task: { name: "reboot", device: deviceId },
          },
          {
            label: "Reset",
            title: "Factory reset device",
            task: { name: "factoryReset", device: deviceId },
          },
          {
            label: "Push file",
            title: "Push a firmware or config file",
            task: { name: "download", devices: [deviceId] },
          },
          {
            label: "Delete",
            title: "Delete device",
            action: () => {
              if (confirm(`Delete device ${deviceId}?`))
                delCmd.set({ resource: "devices", id: deviceId });
            },
          },
        ].map(({ label, title, task: t, action }) => (
          <button
            onclick={() => (action ? action() : taskCmd.set(t))}
            title={title}
            class="px-4 py-2 border border-stone-300 shadow-sm text-sm font-medium rounded-md text-stone-700 bg-white hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  </>
);
