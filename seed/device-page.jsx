// Router that delegates to the appropriate data model-specific device page.
//
// Automatically detects device data model (TR-098 or TR-181) and renders
// the corresponding device page component.
//
// Attributes:
//   deviceId - Device identifier string

const deviceId = node.attributes.deviceId.get();
const device = new Signal.State(null);

const page = new Signal.Computed(() => {
  const dev = device.get()?.[0];
  if (dev?.["Device:object"]) {
    return <device-page-tr181 device={dev} />;
  } else if (dev?.["InternetGatewayDevice:object"]) {
    return <device-page-tr098 device={dev} />;
  }
});

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return (
  <>
    <do-fetch
      arg={{ resource: "devices", filter: `DeviceID.ID = "${deviceId}"` }}
      res={device}
    />
    {page}
  </>
);
