// Displays a device parameter value with optional inline editing.
//
// Attributes:
//   device - Device object containing parameter data
//   param  - Parameter path (e.g., "DeviceID.SerialNumber")
//
// Example:
//   <parameter device={device} param="DeviceID.SerialNumber" />

const device = node.attributes.device.get();
const deviceId = device["DeviceID.ID"];
const param = node.attributes.param.get();
const taskCmd = new Signal.State(null);

const timeAgo = (ts) => {
  const units = [
    { label: "year", ms: 31536000000 },
    { label: "month", ms: 2592000000 },
    { label: "day", ms: 86400000 },
    { label: "hour", ms: 3600000 },
    { label: "minute", ms: 60000 },
    { label: "second", ms: 1000 },
  ];
  let diff = Date.now() - ts;
  const parts = [];
  for (const { label, ms } of units) {
    if (diff >= ms) {
      const n = Math.floor(diff / ms);
      diff %= ms;
      parts.push(`${n} ${label}${n > 1 ? "s" : ""}`);
      if (parts.length === 2) break;
    }
  }
  return `${new Date(ts).toLocaleString()} (${parts.join(" ")} ago)`;
};

const value = device[param];
const type = device[`${param}:type`] || "";
const writable = device[`${param}:writable`];
const timestamp = device[`${param}:valueTimestamp`];
const displayValue =
  typeof value === "number" && type === "xsd:dateTime"
    ? new Date(value).toLocaleString()
    : String(value);

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    <do-task arg={taskCmd} />
    <span
      onmouseover={(e) => timestamp && (e.target.title = timeAgo(timestamp))}
    >
      {displayValue}
    </span>
    {writable && (
      <button
        onclick={() =>
          taskCmd.set({
            name: "setParameterValues",
            devices: [deviceId],
            parameterValues: [[param, value, type]],
          })
        }
      >
        <icon
          name="edit"
          class="inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900"
        />
      </button>
    )}
  </>
);
