/**
 * Copyright 2013-2019  GenieACS Inc.
 *
 * This file is part of GenieACS.
 *
 * GenieACS is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * GenieACS is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with GenieACS.  If not, see <http://www.gnu.org/licenses/>.
 */

import * as localCache from "./local-cache";
import { generateSalt, hashPassword } from "./auth";
import * as db from "./ui/db";
import { del } from "./cache";

interface Status {
  users: boolean;
  presets: boolean;
  filters: boolean;
  device: boolean;
  index: boolean;
  overview: boolean;
}

const BOOTSTRAP_SCRIPT = `
const now = Date.now();

// Clear cached data model to force a refresh
clear("Device", now);
clear("InternetGatewayDevice", now);
`.trim();

const DEFAULT_SCRIPT = `
const hourly = Date.now(3600000);

// Refresh basic parameters hourly
declare("InternetGatewayDevice.DeviceInfo.HardwareVersion", {path: hourly, value: hourly});
declare("InternetGatewayDevice.DeviceInfo.SoftwareVersion", {path: hourly, value: hourly});
declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.MACAddress", {path: hourly, value: hourly});
declare("InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.ExternalIPAddress", {path: hourly, value: hourly});
declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.SSID", {path: hourly, value: hourly});
// Don't refresh password field periodically because CPEs always report blank passowrds for security reasons
declare("InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.KeyPassphrase", {path: hourly, value: 1});
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.HostName", {path: hourly, value: hourly});
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.IPAddress", {path: hourly, value: hourly});
declare("InternetGatewayDevice.LANDevice.*.Hosts.Host.*.MACAddress", {path: hourly, value: hourly});
`.trim();

const INFORM_SCRIPT = `
// Device ID as user name
const username = declare("DeviceID.ID", {value: 1}).value[0]

// Password will be fixed a given device because Math.random() is seeded with devcie ID by default.
const password = Math.trunc(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);

const informInterval = 300;

// Refresh values daily
const daily = Date.now(86400000);

// Unique inform offset per device for better load distribution
const informTime = daily % 86400000;

declare("InternetGatewayDevice.ManagementServer.ConnectionRequestUsername", {value: daily}, {value: username});
declare("InternetGatewayDevice.ManagementServer.ConnectionRequestPassword", {value: daily}, {value: password});
declare("InternetGatewayDevice.ManagementServer.PeriodicInformEnable", {value: daily}, {value: true});
declare("InternetGatewayDevice.ManagementServer.PeriodicInformInterval", {value: daily}, {value: informInterval});
declare("InternetGatewayDevice.ManagementServer.PeriodicInformTime", {value: daily}, {value: informTime});

declare("Device.ManagementServer.ConnectionRequestUsername", {value: daily}, {value: username});
declare("Device.ManagementServer.ConnectionRequestPassword", {value: daily}, {value: password});
declare("Device.ManagementServer.PeriodicInformEnable", {value: daily}, {value: true});
declare("Device.ManagementServer.PeriodicInformInterval", {value: daily}, {value: informInterval});
declare("Device.ManagementServer.PeriodicInformTime", {value: daily}, {value: informTime});
`.trim();

export async function getStatus(): Promise<Status> {
  const configSnapshot = await localCache.getCurrentSnapshot();
  const users = localCache.getUsers(configSnapshot);
  const presets = localCache.getPresets(configSnapshot);
  const ui = localCache.getUiConfig(configSnapshot);

  return {
    users: !Object.keys(users).length,
    presets: !presets.length,
    filters: !Object.keys(ui["filters"]).length,
    device: !Object.keys(ui["device"]).length,
    index: !Object.keys(ui["index"]).length,
    overview: !Object.keys(ui["overview"]).length
  };
}

export async function seed(options): Promise<void> {
  const resources = {};
  const proms = [];

  if (options.users) {
    resources["permissions"] = [
      { role: "admin", resource: "devices", access: 3, validate: "true" },
      { role: "admin", resource: "faults", access: 3, validate: "true" },
      { role: "admin", resource: "files", access: 3, validate: "true" },
      { role: "admin", resource: "presets", access: 3, validate: "true" },
      { role: "admin", resource: "provisions", access: 3, validate: "true" },
      { role: "admin", resource: "config", access: 3, validate: "true" },
      { role: "admin", resource: "permissions", access: 3, validate: "true" },
      { role: "admin", resource: "users", access: 3, validate: "true" },
      {
        role: "admin",
        resource: "virtualParameters",
        access: 3,
        validate: "true"
      }
    ];

    resources["users"] = [
      { username: "admin", password: "admin", roles: ["admin"] }
    ];
  }

  if (options.filters) {
    resources["config"] = (resources["config"] || []).concat([
      { _id: "ui.filters.0.label", value: "'Serial number'" },
      { _id: "ui.filters.0.parameter", value: "DeviceID.SerialNumber" },
      { _id: "ui.filters.0.type", value: "'string'" },
      { _id: "ui.filters.1.label", value: "'Product class'" },
      { _id: "ui.filters.1.parameter", value: "DeviceID.ProductClass" },
      { _id: "ui.filters.1.type", value: "'string'" },
      { _id: "ui.filters.2.label", value: "'Tag'" },
      { _id: "ui.filters.2.type", value: "'tag'" }
    ]);
  }

  if (options.device) {
    resources["config"] = (resources["config"] || []).concat([
      { _id: "ui.device.0.type", value: "'tags'" },
      { _id: "ui.device.1.type", value: "'ping'" },
      { _id: "ui.device.2.type", value: "'parameter-list'" },
      { _id: "ui.device.2.parameters.0.type", value: "'container'" },
      { _id: "ui.device.2.parameters.0.element", value: "'span.inform'" },
      { _id: "ui.device.2.parameters.0.label", value: "'Last inform'" },
      {
        _id: "ui.device.2.parameters.0.components.0.type",
        value: "'parameter'"
      },
      { _id: "ui.device.2.parameters.0.components.1.chart", value: "'online'" },
      {
        _id: "ui.device.2.parameters.0.components.1.type",
        value: "'overview-dot'"
      },
      {
        _id: "ui.device.2.parameters.0.components.2.type",
        value: "'summon-button'"
      },
      {
        _id: "ui.device.2.parameters.0.components.2.parameters.0",
        value: "InternetGatewayDevice.DeviceInfo.HardwareVersion"
      },
      {
        _id: "ui.device.2.parameters.0.components.2.parameters.1",
        value: "InternetGatewayDevice.DeviceInfo.SoftwareVersion"
      },
      {
        _id: "ui.device.2.parameters.0.components.2.parameters.2",
        value:
          "InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.MACAddress"
      },
      {
        _id: "ui.device.2.parameters.0.components.2.parameters.3",
        value:
          "InternetGatewayDevice.WANDevice.*.WANConnectionDevice.*.WANIPConnection.*.ExternalIPAddress"
      },
      {
        _id: "ui.device.2.parameters.0.components.2.parameters.4",
        value: "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.SSID"
      },
      {
        _id: "ui.device.2.parameters.0.components.2.parameters.5",
        value:
          "InternetGatewayDevice.LANDevice.*.WLANConfiguration.*.KeyPassphrase"
      },
      {
        _id: "ui.device.2.parameters.0.components.2.parameters.6",
        value: "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.HostName"
      },
      {
        _id: "ui.device.2.parameters.0.components.2.parameters.7",
        value: "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.IPAddress"
      },
      {
        _id: "ui.device.2.parameters.0.components.2.parameters.8",
        value: "InternetGatewayDevice.LANDevice.*.Hosts.Host.*.MACAddress"
      },
      {
        _id: "ui.device.2.parameters.0.parameter",
        value: "DATE_STRING(Events.Inform)"
      },
      { _id: "ui.device.2.parameters.1.label", value: "'Serial number'" },
      {
        _id: "ui.device.2.parameters.1.parameter",
        value: "DeviceID.SerialNumber"
      },
      { _id: "ui.device.2.parameters.2.label", value: "'Product class'" },
      {
        _id: "ui.device.2.parameters.2.parameter",
        value: "DeviceID.ProductClass"
      },
      { _id: "ui.device.2.parameters.3.label", value: "'OUI'" },
      {
        _id: "ui.device.2.parameters.3.parameter",
        value: "DeviceID.OUI"
      },
      { _id: "ui.device.2.parameters.4.label", value: "'Manufacturer'" },
      {
        _id: "ui.device.2.parameters.4.parameter",
        value: "DeviceID.Manufacturer"
      },
      { _id: "ui.device.2.parameters.5.label", value: "'Hardware version'" },
      {
        _id: "ui.device.2.parameters.5.parameter",
        value: "InternetGatewayDevice.DeviceInfo.HardwareVersion"
      },
      { _id: "ui.device.2.parameters.6.label", value: "'Software version'" },
      {
        _id: "ui.device.2.parameters.6.parameter",
        value: "InternetGatewayDevice.DeviceInfo.SoftwareVersion"
      },
      { _id: "ui.device.2.parameters.7.label", value: "'MAC'" },
      {
        _id: "ui.device.2.parameters.7.parameter",
        value:
          "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.MACAddress"
      },
      { _id: "ui.device.2.parameters.8.label", value: "'IP'" },
      {
        _id: "ui.device.2.parameters.8.parameter",
        value:
          "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress"
      },
      { _id: "ui.device.2.parameters.9.label", value: "'WLAN SSID'" },
      {
        _id: "ui.device.2.parameters.9.parameter",
        value: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID"
      },
      { _id: "ui.device.2.parameters.10.label", value: "'WLAN passphrase'" },
      {
        _id: "ui.device.2.parameters.10.parameter",
        value:
          "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.KeyPassphrase"
      },
      { _id: "ui.device.3.type", value: "'parameter-table'" },
      { _id: "ui.device.3.label", value: "'WLAN hosts'" },
      {
        _id: "ui.device.3.parameter",
        value: "InternetGatewayDevice.LANDevice.1.Hosts.Host"
      },
      { _id: "ui.device.3.childParameters.0.label", value: "'Host name'" },
      { _id: "ui.device.3.childParameters.0.parameter", value: "HostName" },
      { _id: "ui.device.3.childParameters.1.label", value: "'IP address'" },
      { _id: "ui.device.3.childParameters.1.parameter", value: "IPAddress" },
      { _id: "ui.device.3.childParameters.2.label", value: "'MAC address'" },
      { _id: "ui.device.3.childParameters.2.parameter", value: "MACAddress" },
      { _id: "ui.device.4.type", value: "'container'" },
      { _id: "ui.device.4.element", value: "'div'" },
      { _id: "ui.device.4.components.0.components.0", value: "'Faults'" },
      { _id: "ui.device.4.components.0.element", value: "'h3'" },
      { _id: "ui.device.4.components.0.type", value: "'container'" },
      { _id: "ui.device.4.components.1.type", value: "'device-faults'" },
      { _id: "ui.device.5.type", value: "'container'" },
      { _id: "ui.device.5.element", value: "'div.container-full-width'" },
      {
        _id: "ui.device.5.components.0.components.0",
        value: "'All parameters'"
      },
      { _id: "ui.device.5.components.0.element", value: "'h3'" },
      { _id: "ui.device.5.components.0.type", value: "'container'" },
      { _id: "ui.device.5.components.1.type", value: "'all-parameters'" },
      { _id: "ui.device.6.type", value: "'device-actions'" }
    ]);
  }

  if (options.index) {
    resources["config"] = (resources["config"] || []).concat([
      { _id: "ui.index.0.type", value: "'device-link'" },
      { _id: "ui.index.0.label", value: "'Serial number'" },
      { _id: "ui.index.0.parameter", value: "DeviceID.SerialNumber" },
      { _id: "ui.index.0.components.0.type", value: "'parameter'" },
      { _id: "ui.index.1.label", value: "'Product class'" },
      { _id: "ui.index.1.parameter", value: "DeviceID.ProductClass" },
      { _id: "ui.index.2.label", value: "'Software version'" },
      {
        _id: "ui.index.2.parameter",
        value: "InternetGatewayDevice.DeviceInfo.SoftwareVersion"
      },
      { _id: "ui.index.3.label", value: "'IP'" },
      {
        _id: "ui.index.3.parameter",
        value:
          "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress"
      },
      { _id: "ui.index.4.label", value: "'SSID'" },
      {
        _id: "ui.index.4.parameter",
        value: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID"
      },
      { _id: "ui.index.5.type", value: "'container'" },
      { _id: "ui.index.5.label", value: "'Last inform'" },
      { _id: "ui.index.5.element", value: "'span.inform'" },
      { _id: "ui.index.5.parameter", value: "DATE_STRING(Events.Inform)" },
      { _id: "ui.index.5.components.0.type", value: "'parameter'" },
      { _id: "ui.index.5.components.1.chart", value: "'online'" },
      { _id: "ui.index.5.components.1.type", value: "'overview-dot'" },
      { _id: "ui.index.6.type", value: "'tags'" },
      { _id: "ui.index.6.label", value: "'Tags'" },
      { _id: "ui.index.6.parameter", value: "Tags" },
      { _id: "ui.index.6.unsortable", value: "true" },
      { _id: "ui.index.6.writable", value: "false" }
    ]);
  }

  if (options.overview) {
    resources["config"] = (resources["config"] || []).concat([
      { _id: "ui.overview.charts.online.label", value: "'Online status'" },
      {
        _id: "ui.overview.charts.online.slices.1_onlineNow.color",
        value: "'#31a354'"
      },
      {
        _id: "ui.overview.charts.online.slices.1_onlineNow.filter",
        value: "Events.Inform > NOW() - 5 * 60 * 1000"
      },
      {
        _id: "ui.overview.charts.online.slices.1_onlineNow.label",
        value: "'Online now'"
      },
      {
        _id: "ui.overview.charts.online.slices.2_past24.color",
        value: "'#a1d99b'"
      },
      {
        _id: "ui.overview.charts.online.slices.2_past24.filter",
        value:
          "Events.Inform > (NOW() - 5 * 60 * 1000) - (24 * 60 * 60 * 1000) AND Events.Inform < (NOW() - 5 * 60 * 1000)"
      },
      {
        _id: "ui.overview.charts.online.slices.2_past24.label",
        value: "'Past 24 hours'"
      },
      {
        _id: "ui.overview.charts.online.slices.3_others.color",
        value: "'#e5f5e0'"
      },
      {
        _id: "ui.overview.charts.online.slices.3_others.filter",
        value: "Events.Inform < (NOW() - 5 * 60 * 1000) - (24 * 60 * 60 * 1000)"
      },
      {
        _id: "ui.overview.charts.online.slices.3_others.label",
        value: "'Others'"
      },
      { _id: "ui.overview.groups.online.label", value: "''" },
      { _id: "ui.overview.groups.online.charts.0", value: "'online'" }
    ]);
  }

  if (options.presets) {
    resources["presets"] = [
      {
        _id: "bootstrap",
        weight: 0,
        channel: "bootstrap",
        events: "0 BOOTSTRAP",
        provision: "bootstrap"
      },
      { _id: "default", weight: 0, channel: "default", provision: "default" },
      { _id: "inform", weight: 0, channel: "inform", provision: "inform" }
    ];

    resources["provisions"] = [
      { _id: "bootstrap", script: BOOTSTRAP_SCRIPT },
      { _id: "default", script: DEFAULT_SCRIPT },
      { _id: "inform", script: INFORM_SCRIPT }
    ];
  }

  if (resources["permissions"]) {
    for (const p of resources["permissions"]) {
      p["_id"] = `${p["role"]}:${p["resource"]}:${p["access"]}`;
      proms.push(db.putPermission(p["_id"], p));
    }
  }

  if (resources["users"]) {
    for (const u of resources["users"]) {
      u["salt"] = await generateSalt(64);
      u["password"] = await hashPassword(u["password"], u["salt"]);
      u["roles"] = (u["roles"] || []).join(",");
      u["_id"] = u["username"];
      delete u["username"];
      proms.push(db.putUser(u["_id"], u));
    }
  }

  if (resources["provisions"]) {
    for (const p of resources["provisions"])
      proms.push(db.putProvision(p["_id"], p));
  }

  if (resources["presets"])
    for (const p of resources["presets"]) proms.push(db.putPreset(p["_id"], p));

  if (resources["config"])
    for (const c of resources["config"]) proms.push(db.putConfig(c["_id"], c));

  await proms;
  return del("presets_hash");
}
