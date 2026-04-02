// Interactive explorer for browsing and searching device data model parameters.
//
// Attributes:
//   device - Device object containing parameter data
//
// Example:
//   <datamodel-explorer device={device} />

const device = node.attributes.device.get();
const deviceId = device["DeviceID.ID"];
const taskCmd = new Signal.State(null);
const queryString = new Signal.State("");

const allKeys = [];
for (const key of Object.keys(device)) {
  if (key.includes(":")) {
    if (key.endsWith(":object")) {
      const baseKey = key.slice(0, -7);
      const depth = baseKey.split(".").length - 1;
      while (allKeys.length <= depth) allKeys.push([]);
      allKeys[depth].push(baseKey);
    }
    continue;
  }
  const depth = key.split(".").length - 1;
  while (allKeys.length <= depth) allKeys.push([]);
  allKeys[depth].push(key);
}
const flatKeys = allKeys.flat();

const renderRow = (row) => {
  const writable = device[`${row}:writable`];
  const object = device[`${row}:object`];
  const isInstance = /\.[0-9]+$/.test(row);

  return (
    <tr key={row}>
      <td class="pl-4 pr-2 py-2 truncate">
        <span class="inline-block truncate max-w-full">{row}</span>
      </td>
      <td class="pr-4 py-2 text-right flex justify-end">
        {!object && <parameter device={device} param={row} />}
        {object && writable && (
          <button
            onclick={() =>
              taskCmd.set({
                name: isInstance ? "deleteObject" : "addObject",
                device: deviceId,
                objectName: row,
              })
            }
            title={
              isInstance ? "Delete this instance" : "Create a new instance"
            }
          >
            <icon
              name={isInstance ? "delete-instance" : "add-instance"}
              class="inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900"
            />
          </button>
        )}
        <button
          onclick={() =>
            taskCmd.set({
              name: "getParameterValues",
              device: deviceId,
              parameterNames: [row],
            })
          }
          title="Refresh tree"
        >
          <icon
            name="refresh"
            class="inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900"
          />
        </button>
      </td>
    </tr>
  );
};

const explorer = new Signal.Computed(() => {
  const query = queryString.get();
  const regExp =
    query &&
    new RegExp(
      query
        .split(" ")
        .filter(Boolean)
        .map((s) => s.replace(/[-[\]/{}()*+?.\\^$|]/g, "\\$&"))
        .join(".*"),
      "i",
    );

  const filtered = regExp
    ? flatKeys.filter((k) => {
        const value = device[k];
        if (!device[`${k}:object`] && !value) return false;
        return regExp.test(value ? `${k} ${value}` : k);
      })
    : flatKeys;

  const sorted = filtered.sort().slice(0, 100);
  return (
    <>
      <div class="overflow-hidden">
        <div class="overflow-y-scroll h-96 shadow-inner">
          <table class="w-full table-fixed font-mono text-xs text-stone-900">
            <tbody class="divide-y divide-stone-200">
              {sorted.map(renderRow)}
            </tbody>
          </table>
        </div>
      </div>
      <div class="text-stone-700 px-4 py-3 flex justify-between items-end">
        <span class="text-xs">
          Displaying <span class="font-medium">{sorted.length}</span> of{" "}
          <span class="font-medium">{filtered.length}</span> parameters
        </span>
        <a
          href={`api/devices/${encodeURIComponent(deviceId)}.csv`}
          download=""
          class="text-cyan-700 hover:text-cyan-900 text-sm font-medium"
        >
          Download
        </a>
      </div>
    </>
  );
});

let debounceTimer = null;

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    <do-task arg={taskCmd} />
    <div class="bg-white shadow rounded-lg">
      <input
        type="text"
        oninput={(e) => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(
            () => queryString.set(e.target.value),
            500,
          );
        }}
        placeholder="Search parameters"
        class="appearance-none border-0 block w-full px-4 py-3 border-stone-300 placeholder-stone-500 text-stone-900 focus:ring-cyan-500 text-sm rounded-t-lg font-mono focus:ring-2"
      />
      {explorer}
    </div>
  </>
);
