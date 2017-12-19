"use strict";

export default {
  pageSize: 10,
  filter: [
    {
      label: "Serial number",
      parameter: "DeviceID.SerialNumber",
      type: "string"
    },
    {
      label: "Product class",
      parameter: "DeviceID.ProductClass",
      type: "string"
    },
    {
      label: "Tag",
      parameter: "tag",
      type: "string"
    }
  ],
  index: [
    {
      label: "Serial number",
      parameter: "DeviceID.SerialNumber"
    },
    {
      label: "Product class",
      parameter: "DeviceID.ProductClass"
    },
    {
      label: "Software version",
      parameter: "InternetGatewayDevice.DeviceInfo.SoftwareVersion"
    },
    {
      label: "MAC",
      parameter:
        "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress"
    }
  ],
  overview: {
    online: {
      label: "Online devices",
      charts: {
        all: {
          label: "All devices",
          slices: {
            onlineNow: {
              label: "Online now",
              color: "#31a354",
              filter: "Events.Inform > NOW() - 5 * 60 * 1000"
            },
            past24: {
              label: "Past 24 hours",
              color: "#addd8e",
              filter:
                "Events.Inform > (NOW() - 5 * 60 * 1000) - (24 * 60 * 60 * 1000) AND Events.Inform < (NOW() - 5 * 60 * 1000)"
            },
            others: {
              label: "Others",
              color: "#f7fcb9",
              filter: "Events.Inform < (NOW() - 5 * 60 * 1000) - (24 * 60 * 60 * 1000)"
            }
          }
        }
      }
    }
  }
};
