import { getRevision, getUiConfig, getUsers } from "./ui/local-cache.ts";
import { generateSalt, hashPassword } from "./auth.ts";
import { collections } from "./db/db.ts";
import {
  putConfig,
  putPermission,
  putPreset,
  putProvision,
  putUser,
  putView,
} from "./ui/db.ts";
import { del } from "./cache.ts";
import BOOTSTRAP_SCRIPT from "../seed/bootstrap.js" with { type: "text" };
import DEFAULT_SCRIPT from "../seed/default.js" with { type: "text" };
import INFORM_SCRIPT from "../seed/inform.js" with { type: "text" };
import OVERVIEW_PAGE from "../seed/overview-page.jsx" with { type: "text" };
import PIE_CHART from "../seed/pie-chart.jsx" with { type: "text" };
import DEVICE_PAGE from "../seed/device-page.jsx" with { type: "text" };
import DEVICE_PAGE_TR098 from "../seed/device-page-tr098.jsx" with { type: "text" };
import DEVICE_PAGE_TR181 from "../seed/device-page-tr181.jsx" with { type: "text" };
import PARAMETER from "../seed/parameter.jsx" with { type: "text" };
import SUMMON_BUTTON from "../seed/summon-button.jsx" with { type: "text" };
import ICON from "../seed/icon.jsx" with { type: "text" };
import DATAMODEL_EXPLORER from "../seed/datamodel-explorer.jsx" with { type: "text" };
import INSTANCE_TABLE from "../seed/instance-table.jsx" with { type: "text" };
import TAGS from "../seed/tags.jsx" with { type: "text" };

interface Status {
  users: boolean;
  presets: boolean;
  filters: boolean;
  device: boolean;
  index: boolean;
  overview: boolean;
}

export async function getStatus(): Promise<Status> {
  const [configSnapshot, presetCount] = await Promise.all([
    getRevision(),
    collections.presets.countDocuments(),
  ]);
  const users = getUsers(configSnapshot);
  const ui = getUiConfig(configSnapshot);

  const status = {
    users: !Object.keys(users).length,
    presets: !presetCount,
    filters: true,
    device: true,
    index: true,
    overview: true,
  };

  for (const k of Object.keys(ui)) {
    if (k.startsWith("filters.")) status.filters = false;
    if (k === "device" || k.startsWith("device.")) status.device = false;
    if (k.startsWith("index.")) status.index = false;
    if (k === "overview" || k.startsWith("overview.")) status.overview = false;
  }

  return status;
}

export async function seed(options: Record<string, boolean>): Promise<void> {
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
        validate: "true",
      },
      {
        role: "admin",
        resource: "views",
        access: 3,
        validate: "true",
      },
    ];

    resources["users"] = [
      { username: "admin", password: "admin", roles: ["admin"] },
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
      { _id: "ui.filters.2.type", value: "'tag'" },
    ]);
  }

  if (options.device) {
    resources["config"] = (resources["config"] || []).concat([
      { _id: "ui.device", value: "'device-page'" },
    ]);
    resources["views"] = (resources["views"] || []).concat([
      { _id: "device-page", script: DEVICE_PAGE },
      { _id: "device-page-tr098", script: DEVICE_PAGE_TR098 },
      { _id: "device-page-tr181", script: DEVICE_PAGE_TR181 },
      { _id: "parameter", script: PARAMETER },
      { _id: "summon-button", script: SUMMON_BUTTON },
      { _id: "icon", script: ICON },
      { _id: "datamodel-explorer", script: DATAMODEL_EXPLORER },
      { _id: "instance-table", script: INSTANCE_TABLE },
      { _id: "tags", script: TAGS },
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
        value: "InternetGatewayDevice.DeviceInfo.SoftwareVersion",
      },
      { _id: "ui.index.3.label", value: "'IP'" },
      {
        _id: "ui.index.3.parameter",
        value:
          "InternetGatewayDevice.WANDevice.1.WANConnectionDevice.1.WANIPConnection.1.ExternalIPAddress",
      },
      { _id: "ui.index.4.label", value: "'SSID'" },
      {
        _id: "ui.index.4.parameter",
        value: "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.SSID",
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
      { _id: "ui.index.6.writable", value: "false" },
    ]);
  }

  if (options.overview) {
    resources["config"] = (resources["config"] || []).concat([
      { _id: "ui.overview", value: "'overview-page'" },
    ]);
    resources["views"] = (resources["views"] || []).concat([
      { _id: "overview-page", script: OVERVIEW_PAGE },
      { _id: "pie-chart", script: PIE_CHART },
    ]);
  }

  if (options.presets) {
    resources["presets"] = [
      {
        _id: "bootstrap",
        weight: 0,
        channel: "bootstrap",
        events: "0 BOOTSTRAP",
        provision: "bootstrap",
      },
      { _id: "default", weight: 0, channel: "default", provision: "default" },
      { _id: "inform", weight: 0, channel: "inform", provision: "inform" },
    ];

    resources["provisions"] = [
      { _id: "bootstrap", script: BOOTSTRAP_SCRIPT },
      { _id: "default", script: DEFAULT_SCRIPT },
      { _id: "inform", script: INFORM_SCRIPT },
    ];
  }

  if (resources["permissions"]) {
    for (const p of resources["permissions"]) {
      p["_id"] = `${p["role"]}:${p["resource"]}:${p["access"]}`;
      proms.push(putPermission(p["_id"], p));
    }
  }

  if (resources["users"]) {
    for (const u of resources["users"]) {
      u["salt"] = await generateSalt(64);
      u["password"] = await hashPassword(u["password"], u["salt"]);
      u["roles"] = (u["roles"] || []).join(",");
      u["_id"] = u["username"];
      delete u["username"];
      proms.push(putUser(u["_id"], u));
    }
  }

  if (resources["provisions"]) {
    for (const p of resources["provisions"])
      proms.push(putProvision(p["_id"], p));
  }

  if (resources["presets"])
    for (const p of resources["presets"]) proms.push(putPreset(p["_id"], p));

  if (resources["views"])
    for (const v of resources["views"]) proms.push(putView(v["_id"], v));

  if (resources["config"])
    for (const c of resources["config"]) proms.push(putConfig(c["_id"], c));

  await proms;
  await Promise.all([del("ui-local-cache-hash"), del("cwmp-local-cache-hash")]);
}
