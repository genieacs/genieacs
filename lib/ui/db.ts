import { Script } from "node:vm";
import { Readable } from "node:stream";
import { Collection, ObjectId, WithoutId } from "mongodb";
import { encodeTag } from "../util.ts";
import { evaluate } from "../common/expression/util.ts";
import { Expression, Fault, Task } from "../types.ts";
import { collections, filesBucket } from "../db/db.ts";
import { convertOldPrecondition, optimizeProjection } from "../db/util.ts";
import * as MongoTypes from "../db/types.ts";
import { parse, parseList, stringify } from "../common/expression/parser.ts";
import { toMongoQuery } from "../db/synth.ts";

function processDeviceProjection(
  projection: Record<string, 1>,
): Record<string, 1> {
  if (!projection) return projection;
  const p = {};
  for (const [k, v] of Object.entries(projection)) {
    if (k === "DeviceID.ID") {
      p["_id"] = 1;
    } else if (k.startsWith("DeviceID")) {
      p["_deviceId._SerialNumber"] = v;
      p["_deviceId._OUI"] = v;
      p["_deviceId._ProductClass"] = v;
      p["_deviceId._Manufacturer"] = v;
    } else if (k.startsWith("Tags")) {
      p["_tags"] = v;
    } else if (k.startsWith("Events")) {
      p["_lastInform"] = v;
      p["_registered"] = v;
      p["_lastBoot"] = v;
      p["_lastBootstrap"] = v;
    } else {
      p[k] = v;
    }
  }

  return p;
}

function processDeviceSort(
  sort: Record<string, number>,
): Record<string, number> {
  if (!sort) return sort;
  const s = {};
  for (const [k, v] of Object.entries(sort)) {
    if (k === "DeviceID.ID") s["_id"] = v;
    else if (k.startsWith("DeviceID.")) s[`_deviceId._${k.slice(9)}`] = v;
    else if (k === "Events.Inform") s["_lastInform"] = v;
    else if (k === "Events.Registered") s["_registered"] = v;
    else if (k === "Events.1_BOOT") s["_lastBoot"] = v;
    else if (k === "Events.0_BOOTSTRAP") s["_lastBootstrap"] = v;
    else s[`${k}._value`] = v;
  }

  return s;
}

function parseDate(d: Date): number | string {
  const n = +d;
  return isNaN(n) ? "" + d : n;
}

interface FlatAttributes {
  object?: boolean;
  objectTimestamp?: number;
  writable?: boolean;
  writableTimestamp?: number;
  value?: [string | number | boolean, string];
  valueTimestamp?: number;
  notification?: number;
  notificationTimestamp?: number;
  accessList?: string[];
  accessListTimestamp?: number;
}

export interface FlatDevice {
  [param: string]: FlatAttributes;
}

export function flattenDevice(device: Record<string, unknown>): FlatDevice {
  function recursive(
    input,
    root: string,
    output: FlatDevice,
    timestamp: number,
  ): void {
    for (const [name, tree] of Object.entries(input)) {
      if (!root) {
        if (name === "_lastInform") {
          output["Events.Inform"] = {
            value: [parseDate(tree as Date), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_registered") {
          output["Events.Registered"] = {
            value: [parseDate(tree as Date), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_lastBoot") {
          output["Events.1_BOOT"] = {
            value: [parseDate(tree as Date), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_lastBootstrap") {
          output["Events.0_BOOTSTRAP"] = {
            value: [parseDate(tree as Date), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_id") {
          output["DeviceID.ID"] = {
            value: [tree as string, "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_deviceId") {
          output["DeviceID.Manufacturer"] = {
            value: [tree["_Manufacturer"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
          output["DeviceID.OUI"] = {
            value: [tree["_OUI"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
          output["DeviceID.ProductClass"] = {
            value: [tree["_ProductClass"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
          output["DeviceID.SerialNumber"] = {
            value: [tree["_SerialNumber"], "xsd:string"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp,
          };
        } else if (name === "_tags") {
          output["Tags"] = {
            writable: false,
            writableTimestamp: timestamp,
            object: true,
            objectTimestamp: timestamp,
          };

          for (const t of tree as string[]) {
            output[`Tags.${encodeTag(t)}`] = {
              value: [true, "xsd:boolean"],
              valueTimestamp: timestamp,
              writable: true,
              writableTimestamp: timestamp,
              object: false,
              objectTimestamp: timestamp,
            };
          }
        }
      }

      if (name.startsWith("_")) continue;

      let childrenTimestamp = timestamp;

      if (!root) childrenTimestamp = +(input["_timestamp"] || 1);
      else if (+input["_timestamp"] > timestamp)
        childrenTimestamp = +input["_timestamp"];

      const attrs: FlatAttributes = {};
      if (tree["_value"] != null) {
        attrs.value = [
          tree["_value"] instanceof Date ? +tree["_value"] : tree["_value"],
          tree["_type"],
        ];
        attrs.valueTimestamp = +(tree["_timestamp"] || childrenTimestamp);
        attrs.object = false;
        attrs.objectTimestamp = childrenTimestamp;
      } else if (tree["_object"] != null) {
        attrs.object = tree["_object"];
        attrs.objectTimestamp = childrenTimestamp;
      }

      if (tree["_writable"] != null) {
        attrs.writable = tree["_writable"];
        attrs.writableTimestamp = childrenTimestamp;
      }

      if (tree["_notification"] != null) {
        attrs.notification = tree["_notification"];
        attrs.notificationTimestamp = +tree["_attributesTimestamp"] || 1;
      }

      if (tree["_accessList"] != null) {
        attrs.accessList = tree["_accessList"];
        attrs.accessListTimestamp = +tree["_attributesTimestamp"] || 1;
      }

      const r = root ? `${root}.${name}` : name;
      output[r] = attrs;

      if (attrs.object || tree["object"] == null)
        recursive(tree, r, output, childrenTimestamp);
    }
  }

  const newDevice: FlatDevice = {};
  const timestamp = new Date((device["_lastInform"] as Date) || 1).getTime();
  recursive(device, "", newDevice, timestamp);
  return newDevice;
}

function flattenFault(fault: unknown): Fault {
  const f = Object.assign({}, fault) as Fault;
  if (f.timestamp) f.timestamp = +f.timestamp;
  if (f["expiry"]) f["expiry"] = +f["expiry"];
  return f as Fault;
}

function flattenTask(task: unknown): Task {
  const t = Object.assign({}, task) as Task;
  t._id = "" + t._id;
  if (t["timestamp"]) t["timestamp"] = +t["timestamp"];
  if (t.expiry) t.expiry = +t.expiry;
  return t;
}

function flattenPreset(
  preset: Record<string, unknown>,
): Record<string, unknown> {
  const p = Object.assign({}, preset);
  if (p.precondition) {
    try {
      // Try parse to check expression validity
      parse(p.precondition as string);
    } catch (error) {
      p.precondition = convertOldPrecondition(
        JSON.parse(p.precondition as string),
      );
      p.precondition = (p.precondition as string).length
        ? stringify(p.precondition as Expression)
        : "";
    }
  }

  if (p.events) {
    const e = [];
    for (const [k, v] of Object.entries(p.events)) e.push(v ? k : `-${k}`);
    p.events = e.join(", ");
  }

  const provision = p.configurations[0];
  if (
    (p.configurations as any[]).length === 1 &&
    provision.type === "provision" &&
    provision.name &&
    provision.name.length
  ) {
    p.provision = provision.name;
    p.provisionArgs = provision.args
      ? provision.args.map((a) => stringify(a)).join(", ")
      : "";
  }

  delete p.configurations;
  return p;
}

function flattenFile(file: Record<string, unknown>): Record<string, unknown> {
  const f = {};
  f["_id"] = file["_id"];
  if (file.metadata) {
    f["metadata.fileType"] = file["metadata"]["fileType"] || "";
    f["metadata.oui"] = file["metadata"]["oui"] || "";
    f["metadata.productClass"] = file["metadata"]["productClass"] || "";
    f["metadata.version"] = file["metadata"]["version"] || "";
  }
  return f;
}

function preProcessPreset(data: Record<string, unknown>): MongoTypes.Preset {
  const preset = Object.assign({}, data);

  if (!preset.precondition) preset.precondition = "";
  // Try parse to check expression validity
  parse(preset.precondition as string);

  preset.weight = parseInt(preset.weight as string) || 0;

  const events = {};
  if (preset.events) {
    for (let e of (preset.events as string).split(",")) {
      let v = true;
      e = e.trim();
      if (e.startsWith("-")) {
        v = false;
        e = e.slice(1).trim();
      }
      if (e) events[e] = v;
    }
  }

  preset.events = events;

  if (!preset.provision) throw new Error("Invalid preset provision");

  const configuration = {
    type: "provision",
    name: preset.provision,
    args: null,
  };

  if (preset.provisionArgs)
    configuration.args = parseList(preset.provisionArgs as string);

  delete preset.provision;
  delete preset.provisionArgs;
  preset.configurations = [configuration];
  return preset as unknown as MongoTypes.Preset;
}

interface QueryOptions {
  projection?: any;
  skip?: number;
  limit?: number;
  sort?: {
    [param: string]: number;
  };
}

export async function* query(
  resource: string,
  filter: Expression,
  options?: QueryOptions,
): AsyncGenerator<any, void, undefined> {
  options = options || {};
  filter = evaluate(filter, null, Date.now());
  const q = toMongoQuery(filter, resource);
  if (!q) return;

  const collection = collections[resource] as Collection<any>;
  const cursor = collection.find(q);
  if (options.projection) {
    let projection = options.projection;
    if (resource === "devices")
      projection = processDeviceProjection(options.projection);

    if (resource === "presets") projection.configurations = 1;
    projection = optimizeProjection(projection);
    cursor.project(projection);
  }

  if (resource === "users") cursor.project({ password: 0, salt: 0 });

  if (options.skip) cursor.skip(options.skip);
  if (options.limit) cursor.limit(options.limit);

  if (options.sort) {
    let s = Object.entries(options.sort)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .reduce(
        (obj, [k, v]) =>
          Object.assign(obj, { [k]: Math.min(Math.max(v, -1), 1) }),
        {},
      );

    if (resource === "devices") s = processDeviceSort(s);
    cursor.sort(s);
  }

  for await (let doc of cursor) {
    if (resource === "devices") doc = flattenDevice(doc);
    else if (resource === "faults") doc = flattenFault(doc);
    else if (resource === "tasks") doc = flattenTask(doc);
    else if (resource === "presets") doc = flattenPreset(doc);
    else if (resource === "files") doc = flattenFile(doc);

    yield doc;
  }
}

export function count(resource: string, filter: Expression): Promise<number> {
  const collection = collections[resource] as Collection<any>;
  filter = evaluate(filter, null, Date.now());
  const q = toMongoQuery(filter, resource);
  if (!q) return Promise.resolve(0);
  return collection.countDocuments(q);
}

export async function updateDeviceTags(
  deviceId: string,
  tags: Record<string, boolean>,
): Promise<void> {
  const add = [];
  const pull = [];

  for (let [tag, onOff] of Object.entries(tags)) {
    tag = tag.trim();
    if (onOff) add.push(tag);
    else pull.push(tag);
  }
  const object = {};

  if (add?.length) object["$addToSet"] = { _tags: { $each: add } };
  if (pull?.length) object["$pullAll"] = { _tags: pull };

  await collections.devices.updateOne({ _id: deviceId }, object);
}

export async function putPreset(
  id: string,
  object: Record<string, unknown>,
): Promise<void> {
  const p = preProcessPreset(object);
  await collections.presets.replaceOne({ _id: id }, p, { upsert: true });
}

export async function deletePreset(id: string): Promise<void> {
  await collections.presets.deleteOne({ _id: id });
}

export async function putProvision(
  id: string,
  object: { script: string },
): Promise<void> {
  if (!object.script) object.script = "";
  try {
    new Script(`"use strict";(function(){\n${object.script}\n})();`, {
      filename: id,
      lineOffset: -1,
    });
  } catch (err) {
    if (err.stack?.startsWith(`${id}:`)) {
      return Promise.reject(
        new Error(`${err.name} at ${err.stack.split("\n", 1)[0]}`),
      );
    }
    return Promise.reject(err);
  }
  await collections.provisions.replaceOne({ _id: id }, object, {
    upsert: true,
  });
}

export async function deleteProvision(id: string): Promise<void> {
  await collections.provisions.deleteOne({ _id: id });
}

export async function putVirtualParameter(
  id: string,
  object: { script: string },
): Promise<void> {
  if (!object.script) object.script = "";
  try {
    new Script(`"use strict";(function(){\n${object.script}\n})();`, {
      filename: id,
      lineOffset: -1,
    });
  } catch (err) {
    if (err.stack?.startsWith(`${id}:`)) {
      return Promise.reject(
        new Error(`${err.name} at ${err.stack.split("\n", 1)[0]}`),
      );
    }
    return Promise.reject(err);
  }
  await collections.virtualParameters.replaceOne({ _id: id }, object, {
    upsert: true,
  });
}

export async function deleteVirtualParameter(id: string): Promise<void> {
  await collections.virtualParameters.deleteOne({ _id: id });
}

export async function putConfig(
  id: string,
  object: WithoutId<MongoTypes.Config>,
): Promise<void> {
  await collections.config.replaceOne({ _id: id }, object, { upsert: true });
}

export async function deleteConfig(id: string): Promise<void> {
  await collections.config.deleteOne({ _id: id });
}

export async function putPermission(
  id: string,
  object: WithoutId<MongoTypes.Permission>,
): Promise<void> {
  await collections.permissions.replaceOne({ _id: id }, object, {
    upsert: true,
  });
}

export async function deletePermission(id: string): Promise<void> {
  await collections.permissions.deleteOne({ _id: id });
}

export async function putUser(
  id: string,
  object: Partial<WithoutId<MongoTypes.User>>,
): Promise<void> {
  // update instead of replace to keep the password if not set by user
  await collections.users.updateOne(
    { _id: id },
    { $set: object },
    { upsert: true },
  );
}

export async function deleteUser(id: string): Promise<void> {
  await collections.users.deleteOne({ _id: id });
}

export function downloadFile(filename: string): Readable {
  return filesBucket.openDownloadStreamByName(filename);
}

export function putFile(
  filename: string,
  metadata: Record<string, string>,
  contentStream: Readable,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const uploadStream = filesBucket.openUploadStreamWithId(
      filename as unknown as ObjectId,
      filename,
      {
        metadata: metadata,
      },
    );

    let readableEnded = false;
    contentStream.on("end", () => {
      readableEnded = true;
    });
    contentStream.on("close", () => {
      // In Node versions prior to 15, the stream will not emit an error if the
      // connection is closed before the stream is finished.
      // For Node 12.9+ we can just use stream.readableEnded
      if (!readableEnded)
        uploadStream.destroy(new Error("Stream closed prematurely"));
    });

    contentStream.on("error", (err) => {
      uploadStream.destroy(err);
    });

    uploadStream.on("error", reject);
    uploadStream.on("finish", resolve);
    contentStream.pipe(uploadStream);
  });
}

export async function deleteFile(filename: string): Promise<void> {
  await filesBucket.delete(filename as any);
}

export async function deleteFault(id: string): Promise<void> {
  await collections.faults.deleteOne({ _id: id });
}

export async function deleteTask(id: ObjectId): Promise<void> {
  await collections.tasks.deleteOne({ _id: id });
}
