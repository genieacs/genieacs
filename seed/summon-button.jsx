// Button that initiates a device session and refreshes parameters.
//
// Attributes:
//   deviceId - Device identifier string
//   params   - Array of parameter paths to refresh (optional)
//
// Example:
//   <summon-button deviceId={deviceId} params={["Device.DeviceInfo.SoftwareVersion"]} />

const taskCmd = new Signal.State(null);
const status = new Signal.State(null);
const deviceId = node.attributes.deviceId.get();

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    <do-task arg={taskCmd} res={status} />
    <do-notify
      arg={
        new Signal.Computed(() => {
          const s = status.get();
          if (s === "stale" || s === "fault")
            return { type: "error", message: `${deviceId}: ${s}` };
          if (s === "done")
            return { type: "success", message: `${deviceId}: Summoned` };
          return null;
        })
      }
    />
    <button
      onclick={() =>
        taskCmd.set({
          name: "getParameterValues",
          commit: true,
          parameterNames: node.attributes.params.get() ?? [],
          device: deviceId,
        })
      }
      disabled={
        new Signal.Computed(() => ["pending", "queued"].includes(status.get()))
      }
      title="Initiate session and refresh basic parameters"
      class="px-2.5 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500"
    >
      Summon
    </button>
  </>
);
