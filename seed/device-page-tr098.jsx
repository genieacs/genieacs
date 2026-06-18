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
const overlayOpen = new Signal.State(false);
const overlayContent = new Signal.State(null);
const deviceUploads = new Signal.State(null);

const overlayDialog = new Signal.Computed(() => {
  if (!overlayOpen.get() || !overlayContent.get()) return null;
  return (
    <div
      class="fixed z-20 inset-0 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div class="flex items-center justify-center min-h-screen p-4 text-center">
        <div class="fixed inset-0 bg-black/50" aria-hidden="true" />
        <div class="relative z-10 bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform max-w-full ">
          <div class="block absolute top-0 right-0 pt-4 pr-4">
            <button
              type="button"
              class="bg-white rounded-md text-stone-400 hover:text-stone-500 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500"
              onclick={() => overlayOpen.set(false)}
            >
              <span class="sr-only">Close</span>
              <icon name="close" class="h-6 w-6" />{" "}
            </button>
          </div>
          <div>{overlayContent}</div>
        </div>
      </div>
    </div>
  );
});

const handleOverlayEscape = (e) => {
  if (e.key === "Escape" && overlayOpen.get()) overlayOpen.set(false);
};
addEventListener("keydown", handleOverlayEscape);

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
            onclick={() => {
              overlayContent.set(
                <>
                  <textarea
                    class="font-mono text-sm w-full border border-stone-300 rounded-md"
                    cols="80"
                    rows="24"
                    readonly=""
                  >
                    {yamlOut}
                  </textarea>
                </>,
              );
              overlayOpen.set(true);
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

const uploadRows = new Signal.Computed(() => {
  const files = deviceUploads.get() || [];
  const fileIds = new Set(files.map((f) => f._id));
  const uploads = {};

  for (const [key, value] of Object.entries(device)) {
    if (!key.startsWith("Uploads.") || key.includes(":")) continue;
    const parts = key.split(".");
    if (parts.length !== 3) continue;
    uploads[parts[1]] = uploads[parts[1]] || {};
    uploads[parts[1]][parts[2]] = value;
  }

  const uploadsSorted = Object.values(uploads)
    .filter((u) => u["Upload"])
    .sort((a, b) => a["Upload"] - b["Upload"]);

  const render = [];
  for (const u of uploadsSorted) {
    const filePath = `${deviceId}/${u["FileName"]}`;
    const ready = u?.["LastUpload"] >= u?.["Upload"];
    if (ready && !fileIds.has(filePath)) {
      continue;
    }
    render.push(
      Object.assign({}, u, {
        status: ready ? "Ready" : "Waiting for Upload",
      }),
    );
  }
  if (render.length === 0) {
    return (
      <tr>
        <td
          class="bg-stripes text-sm font-medium text-center text-stone-500 p-4"
          colspan={5}
        >
          No Uploads
        </td>
      </tr>
    );
  }
  return render.map((u) => {
    const filePath = `${deviceId}/${u["FileName"]}`;

    return (
      <tr>
        <td class="pl-6 pr-3 py-4 whitespace-nowrap text-sm text-stone-900">
          {u["FileName"]}
        </td>
        <td class="px-3 py-4 whitespace-nowrap text-sm text-stone-500">
          {u["FileType"]}
        </td>
        <td class="px-3 py-4 whitespace-nowrap text-sm text-stone-500">
          {new Date(u["LastUpload"]).toLocaleString()}
        </td>
        {u.status === "Ready" ? (
          <td class="px-3 py-4 whitespace-nowrap text-sm">
            <a
              href={`/api/uploads/blob/${encodeURIComponent(filePath)}`}
              class="text-cyan-600 hover:text-cyan-900 font-medium"
            >
              Ready
            </a>
          </td>
        ) : (
          <td class="px-3 py-4 whitespace-nowrap text-sm text-stone-500">
            Waiting for Upload
          </td>
        )}
        <td class="pl-3 pr-6 py-4 whitespace-nowrap text-right text-sm font-medium">
          {u.status === "Ready" && (
            <button
              onclick={() => {
                delCmd.set({ resource: "uploads", id: filePath });
              }}
              title="Delete file"
            >
              <icon
                name="delete-instance"
                class="inline h-4 w-4 text-cyan-700 hover:text-cyan-900"
              />
            </button>
          )}
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
                  xmlns="http://www.w3.org/2000/svg"
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
      {overlayDialog}
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
          {
            label: "Upload",
            title: "Upload a file from the device",
            action: () => {
              overlayContent.set(
                <>
                  <h2 class="text-lg font-medium leading-6 text-stone-900">
                    Uploads from {deviceId}
                  </h2>
                  <do-fetch
                    arg={{
                      resource: "uploads",
                      filter: `_id > '${deviceId}/' AND _id < '${deviceId}/zzzz'`,
                    }}
                    res={deviceUploads}
                  />
                  <div class="shadow overflow-hidden rounded-lg w-full">
                    <table class="w-full divide-y divide-stone-200">
                      <thead class="bg-stone-50">
                        <tr>
                          {["Filename", "Type", "Timestamp", "Status"].map(
                            (label, i) => (
                              <th
                                class={`py-3.5 text-left text-sm font-semibold text-stone-500 ${i ? "px-3" : "pl-6 pr-3"}`}
                              >
                                {label}
                              </th>
                            ),
                          )}
                          <th class="pl-3" />
                        </tr>
                      </thead>
                      <tbody class="bg-white divide-y divide-stone-200">
                        {uploadRows}
                      </tbody>
                    </table>
                  </div>
                  <button
                    onclick={() =>
                      taskCmd.set({ name: "upload", devices: [deviceId] })
                    }
                    title="Fetch a new file from device"
                  >
                    <icon
                      name="add-instance"
                      class="inline h-4 w-4 mr-1 text-cyan-700"
                    />
                  </button>
                </>,
              );
              overlayOpen.set(true);
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
