// Table component for displaying object instances with configurable columns.
//
// Attributes:
//   device - Device object containing parameter data
//   root   - Object path to display instances from (e.g., "Device.Hosts.Host")
//
// Children:
//   <param> elements defining columns:
//     label - Column header text
//     param - Parameter name relative to instance (e.g., "HostName")
//
// Example:
//   <instance-table root="Device.Hosts.Host" device={device}>
//     <param label="Host name" param="HostName" />
//     <param label="IP" param="IPAddress" />
//   </instance-table>

const device = node.attributes.device.get();
const deviceId = device["DeviceID.ID"];
const root = node.attributes.root.get();
const taskCmd = new Signal.State(null);

const columns = node.children
  .map((c) => c.get())
  .filter((c) => c.name === "param")
  .map(({ attributes: { label, param } }) => ({ label, param }));

const instances = [
  ...new Set(
    Object.keys(device)
      .filter((k) => k.startsWith(`${root}.`) && !k.includes(":"))
      .map((k) => {
        const dot = k.indexOf(".", root.length + 1);
        return dot === -1 ? k : k.slice(0, dot);
      }),
  ),
];

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    <do-task arg={taskCmd} />
    <div class="shadow overflow-hidden rounded-lg w-max">
      <table class="divide-y divide-stone-200">
        <thead class="bg-stone-50">
          <tr>
            {columns.map(({ label }, i) => (
              <th
                class={`py-3.5 text-left text-sm font-semibold text-stone-500 ${i ? "px-3" : "pl-6 pr-3"}`}
              >
                {label}
              </th>
            ))}
            <th class="pl-3" />
          </tr>
        </thead>
        <tbody class="bg-white divide-y divide-stone-200">
          {instances.length ? (
            instances.map((inst) => (
              <tr>
                {columns.map(({ param }, i) => (
                  <td
                    class={`whitespace-nowrap py-4 text-sm text-stone-900 ${i ? "px-3" : "pl-6 pr-3"}`}
                  >
                    <parameter device={device} param={`${inst}.${param}`} />
                  </td>
                ))}
                <td class="whitespace-nowrap pl-3 pr-6 py-4">
                  {device[`${inst}:writable`] && (
                    <button
                      onclick={() =>
                        taskCmd.set({
                          name: "deleteObject",
                          device: deviceId,
                          objectName: inst,
                        })
                      }
                    >
                      <icon
                        name="delete-instance"
                        class="inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900"
                      />
                    </button>
                  )}
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td
                class="bg-stripes text-sm font-medium text-center text-stone-500 p-4"
                colspan={columns.length + 1}
              >
                No instances
              </td>
            </tr>
          )}
          {device[`${root}:writable`] && (
            <tr>
              <td
                class="whitespace-nowrap pl-3 pr-6 py-4 text-sm"
                colspan={columns.length + 1}
              >
                <button
                  onclick={() =>
                    taskCmd.set({
                      name: "addObject",
                      device: deviceId,
                      objectName: root,
                    })
                  }
                >
                  <icon
                    name="add-instance"
                    class="inline h-4 w-4 ml-1 text-cyan-700 hover:text-cyan-900"
                  />
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  </>
);
