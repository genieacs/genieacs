// Displays and manages device tags with add/remove functionality.
//
// Attributes:
//   device   - Device object containing tag data
//   writable - Whether to show add/remove buttons (default: true)
//
// Example:
//   <tags device={device} writable={true} />

const device = node.attributes.device.get();
const deviceId = device["DeviceID.ID"];
const tagCmd = new Signal.State(null);
const writable = node.attributes.writable.get() ?? true;

const tags = Object.keys(device)
  .filter((key) => key.startsWith("Tags.") && !key.includes(":"))
  .map((key) =>
    decodeURIComponent(key.slice(5).replace(/0x(?=[0-9A-Z]{2})/g, "%")),
  )
  .sort();

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    <do-update-tags arg={tagCmd} />
    {tags.map((t) => (
      <span class="inline-flex items-center pl-3 pr-1 py-0.5 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800 mr-2 ring-1 ring-yellow-200">
        {t}
        {writable && (
          <button
            onclick={(e) => {
              e.currentTarget.blur();
              tagCmd.set({ deviceId, tags: { [t]: false } });
            }}
            title="Remove tag"
            class="flex-shrink-0 ml-0.5 h-4 w-4 rounded-full inline-flex items-center justify-center text-yellow-400 hover:bg-yellow-200 hover:text-yellow-500 focus:outline-none focus:bg-yellow-500 focus:text-white"
          >
            <span class="sr-only">Remove tag</span>
            <icon name="remove" class="inline h-4 w-4 text-yellow-400" />
          </button>
        )}
      </span>
    ))}
    {writable && (
      <span class="inline-flex items-center pl-1 pr-1 py-0.5 rounded-full text-sm font-medium bg-yellow-50 ring-1 ring-yellow-200">
        <button
          title="Add tag"
          onclick={(e) => {
            e.currentTarget.blur();
            const t = window.prompt(`Enter tag to assign to device:`);
            if (t) tagCmd.set({ deviceId, tags: { [t]: true } });
          }}
          class="flex-shrink-0 h-4 w-4 rounded-full inline-flex items-center justify-center text-yellow-400 hover:bg-yellow-200 hover:text-yellow-500 focus:outline-none focus:bg-yellow-500 focus:text-white"
        >
          <span class="sr-only">Add tag</span>
          <icon name="add" class="inline h-4 w-4 text-yellow-400" />
        </button>
      </span>
    )}
  </>
);
