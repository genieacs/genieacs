import { ObjectId } from "mongodb";
import { decodeTag, encodeTag, escapeRegExp } from "../util.ts";
import {
  DeviceData,
  Attributes,
  SessionFault,
  Task,
  Operation,
} from "../types.ts";
import Path from "../common/path.ts";
import { collections } from "../db/db.ts";
import { optimizeProjection } from "../db/util.ts";
import * as MongoTypes from "../db/types.ts";

const INVALID_PATH_SUFFIX = "__invalid";

function compareAccessLists(list1: string[], list2: string[]): boolean {
  if (list1.length !== list2.length) return false;
  for (const [i, v] of list1.entries()) if (v !== list2[i]) return false;
  return true;
}

export async function fetchDevice(
  id: string,
  timestamp: number,
): Promise<[Path, number, Attributes?][]> {
  const res: [Path, number, Attributes?][] = [
    [
      Path.parse("Events"),
      timestamp,
      { object: [timestamp, 1], writable: [timestamp, 0] },
    ],
    [
      Path.parse("DeviceID"),
      timestamp,
      { object: [timestamp, 1], writable: [timestamp, 0] },
    ],
  ];

  const device = await collections.devices.findOne({ _id: id });
  if (!device) return null;

  function storeParams(
    obj,
    path: string,
    pathLength: number,
    ts: number,
  ): void {
    if (obj["_timestamp"]) obj["_timestamp"] = +obj["_timestamp"];
    if (obj["_attributesTimestamp"])
      obj["_attributesTimestamp"] = +obj["_attributesTimestamp"];

    const attrs: Attributes = {};
    let t = obj["_timestamp"] || 1;
    if (ts > t) t = ts;

    if (obj["_value"] != null) {
      attrs.value = [obj["_timestamp"] || 1, [obj["_value"], obj["_type"]]];
      if (obj["_type"] === "xsd:dateTime" && obj["_value"] instanceof Date)
        attrs.value[1][0] = +attrs.value[1][0];

      obj["_object"] = false;
    }
    if (obj["_writable"] != null)
      attrs.writable = [ts || 1, obj["_writable"] ? 1 : 0];

    if (obj["_object"] != null) attrs.object = [t, obj["_object"] ? 1 : 0];

    if (obj["_notification"] != null) {
      attrs.notification = [
        obj["_attributesTimestamp"] || 1,
        obj["_notification"],
      ];
    }

    if (obj["_accessList"] != null)
      attrs.accessList = [obj["_attributesTimestamp"] || 1, obj["_accessList"]];

    try {
      res.push([Path.parse(path), t, attrs]);
    } catch (err) {
      // The path parser is now more strict so we might be in a situation where
      // the database contains invalid paths from before this change So here we
      // encode the invalid characters.
      const splits = path.split(".");
      splits[splits.length - 1] =
        encodeTag(splits[splits.length - 1]) + INVALID_PATH_SUFFIX;
      path = splits.join(".");
      res.push([Path.parse(path), t, attrs]);
      return;
    }

    for (const [k, v] of Object.entries(obj)) {
      if (!k.startsWith("_")) {
        obj["_object"] = true;
        storeParams(v, `${path}.${k}`, pathLength + 1, obj["_timestamp"]);
      }
    }

    if (obj["_object"] && obj["_timestamp"])
      res.push([Path.parse(path + ".*"), obj["_timestamp"]]);
  }

  const ts: number = +device["_timestamp"] || 0;
  if (ts) res.push([Path.parse("*"), ts]);

  for (const [k, v] of Object.entries(device)) {
    switch (k) {
      case "_lastInform":
        res.push([
          Path.parse("Events.Inform"),
          +v,
          {
            object: [+v, 0],
            writable: [+v, 0],
            value: [+v, [+v, "xsd:dateTime"]],
          },
        ]);
        break;
      case "_lastBoot":
        res.push([
          Path.parse("Events.1_BOOT"),
          +v,
          {
            object: [+v, 0],
            writable: [+v, 0],
            value: [+v, [+v, "xsd:dateTime"]],
          },
        ]);
        break;
      case "_lastBootstrap":
        res.push([
          Path.parse("Events.0_BOOTSTRAP"),
          +v,
          {
            object: [+v, 0],
            writable: [+v, 0],
            value: [+v, [+v, "xsd:dateTime"]],
          },
        ]);
        break;
      case "_registered":
        // Use current timestamp for registered event attribute timestamps
        res.push([
          Path.parse("Events.Registered"),
          timestamp,
          {
            object: [timestamp, 0],
            writable: [timestamp, 0],
            value: [timestamp, [+v, "xsd:dateTime"]],
          },
        ]);
        break;
      case "_id":
        res.push([
          Path.parse("DeviceID.ID"),
          timestamp,
          {
            object: [timestamp, 0],
            writable: [timestamp, 0],
            value: [timestamp, [v as string, "xsd:string"]],
          },
        ]);
        break;
      case "_tags":
        if ((v as string[]).length) {
          res.push([
            Path.parse("Tags"),
            timestamp,
            { object: [timestamp, 1], writable: [timestamp, 0] },
          ]);
        }

        for (const t of v as string[]) {
          res.push([
            Path.parse("Tags." + encodeTag(t)),
            timestamp,
            {
              object: [timestamp, 0],
              writable: [timestamp, 1],
              value: [timestamp, [true, "xsd:boolean"]],
            },
          ]);
        }
        break;
      case "_deviceId":
        if (v["_Manufacturer"] != null) {
          res.push([
            Path.parse("DeviceID.Manufacturer"),
            timestamp,
            {
              object: [timestamp, 0],
              writable: [timestamp, 0],
              value: [timestamp, [v["_Manufacturer"], "xsd:string"]],
            },
          ]);
        }

        if (v["_OUI"] != null) {
          res.push([
            Path.parse("DeviceID.OUI"),
            timestamp,
            {
              object: [timestamp, 0],
              writable: [timestamp, 0],
              value: [timestamp, [v["_OUI"], "xsd:string"]],
            },
          ]);
        }

        if (v["_ProductClass"] != null) {
          res.push([
            Path.parse("DeviceID.ProductClass"),
            timestamp,
            {
              object: [timestamp, 0],
              writable: [timestamp, 0],
              value: [timestamp, [v["_ProductClass"], "xsd:string"]],
            },
          ]);
        }

        if (v["_SerialNumber"] != null) {
          res.push([
            Path.parse("DeviceID.SerialNumber"),
            timestamp,
            {
              object: [timestamp, 0],
              writable: [timestamp, 0],
              value: [timestamp, [v["_SerialNumber"], "xsd:string"]],
            },
          ]);
        }
        break;
      default:
        if (!k.startsWith("_")) storeParams(v, k, 1, ts);
    }
  }
  return res;
}

export async function saveDevice(
  deviceId: string,
  deviceData: DeviceData,
  isNew: boolean,
  sessionTimestamp: number,
): Promise<void> {
  const update = { $set: {}, $unset: {}, $addToSet: {}, $pull: {} };

  for (const diff of deviceData.timestamps.diff()) {
    if (diff[0].wildcard !== 1 << (diff[0].length - 1)) continue;

    if (
      diff[0].segments[0] === "Events" ||
      diff[0].segments[0] === "DeviceID" ||
      diff[0].segments[0] === "Tags"
    )
      continue;

    const parent = deviceData.paths.get(diff[0].slice(0, -1));

    // Param timestamps may be greater than session timestamp to track revisions
    if (diff[2] > sessionTimestamp) diff[2] = sessionTimestamp;

    if (diff[2] == null && diff[1] != null) {
      update["$unset"][
        parent.length ? parent.toString() + "._timestamp" : "_timestamp"
      ] = 1;
    } else {
      if (parent && (!parent.length || deviceData.attributes.has(parent))) {
        update["$set"][
          parent.length ? parent.toString() + "._timestamp" : "_timestamp"
        ] = new Date(diff[2]);
      }
    }
  }

  for (const diff of deviceData.attributes.diff()) {
    const path = diff[0];
    const value1 = (((diff[1] || {}).value || [])[1] || [])[0];
    const value2 = (((diff[2] || {}).value || [])[1] || [])[0];
    const valueType1 = (((diff[1] || {}).value || [])[1] || [])[1];
    const valueType2 = (((diff[2] || {}).value || [])[1] || [])[1];
    const valueTimestamp1 = ((diff[1] || {}).value || [])[0];
    const valueTimestamp2 = ((diff[2] || {}).value || [])[0];
    const object1 = ((diff[1] || {}).object || [])[1];
    const object2 = ((diff[2] || {}).object || [])[1];
    const writable2 = ((diff[2] || {}).writable || [])[1];
    const writable1 = ((diff[1] || {}).writable || [])[1];
    const attributesTimestamp1 = ((diff[1] || {}).notification || [])[0];
    const attributesTimestamp2 = ((diff[2] || {}).notification || [])[0];
    const notification1 = ((diff[1] || {}).notification || [])[1];
    const notification2 = ((diff[2] || {}).notification || [])[1];
    const accessList1 = ((diff[1] || {}).accessList || [])[1];
    const accessList2 = ((diff[2] || {}).accessList || [])[1];

    switch (path.segments[0]) {
      case "Events":
        if (path.length === 2 && value2 !== value1) {
          if (!diff[2]) {
            switch (path.segments[1]) {
              case "Inform":
                update["$unset"]["_lastInform"] = 1;
                break;
              case "1_BOOT":
                update["$unset"]["_lastBoot"] = 1;
                break;
              case "0_BOOTSTRAP":
                update["$unset"]["_lastBootstrap"] = 1;
                break;
              case "Registered":
                update["$unset"]["_registered"] = 1;
            }
          } else {
            const t = new Date(diff[2].value[1][0] as number);
            switch (path.segments[1]) {
              case "Inform":
                update["$set"]["_lastInform"] = t;
                break;
              case "1_BOOT":
                update["$set"]["_lastBoot"] = t;
                break;
              case "0_BOOTSTRAP":
                update["$set"]["_lastBootstrap"] = t;
                break;
              case "Registered":
                update["$set"]["_registered"] = t;
            }
          }
        }

        break;
      case "DeviceID":
        if (value2 !== value1) {
          const v = diff[2].value[1][0];
          switch (path.segments[1]) {
            case "ID":
              update["$set"]["_id"] = v;
              break;
            case "Manufacturer":
              update["$set"]["_deviceId._Manufacturer"] = v;
              break;
            case "OUI":
              update["$set"]["_deviceId._OUI"] = v;
              break;
            case "ProductClass":
              update["$set"]["_deviceId._ProductClass"] = v;
              break;
            case "SerialNumber":
              update["$set"]["_deviceId._SerialNumber"] = v;
          }
        }
        break;
      case "Tags":
        if (value2 !== value1) {
          if (value2 != null) {
            if (!update["$addToSet"]["_tags"])
              update["$addToSet"]["_tags"] = { $each: [] };
            update["$addToSet"]["_tags"]["$each"].push(
              decodeTag(path.segments[1] as string),
            );
          } else {
            if (!update["$pull"]["_tags"]) {
              update["$pull"]["_tags"] = {
                $in: [],
              };
            }
            update["$pull"]["_tags"]["$in"].push(
              decodeTag(path.segments[1] as string),
            );
          }
        }

        break;
      default:
        if (!diff[2]) {
          let pathStr = path.toString();
          // Paths with that suffix are encoded and need to be decoded
          if (pathStr.endsWith(INVALID_PATH_SUFFIX)) {
            const splits = pathStr.split(".");
            splits[splits.length - 1] = decodeTag(
              splits[splits.length - 1].slice(
                0,
                0 - INVALID_PATH_SUFFIX.length,
              ),
            );
            pathStr = splits.join(".");
          }
          update["$unset"][pathStr] = 1;
          continue;
        }

        for (const attrName of Object.keys(diff[2])) {
          // Param timestamps may be greater than session timestamp to track revisions
          if (diff[2][attrName][0] > sessionTimestamp)
            diff[2][attrName][0] = sessionTimestamp;

          if (diff[2][attrName][1] != null) {
            switch (attrName) {
              case "value":
                if (value2 !== value1) {
                  if (
                    valueType2 === "xsd:dateTime" &&
                    Number.isInteger(value2 as number)
                  ) {
                    update["$set"][path.toString() + "._value"] = new Date(
                      value2 as number,
                    );
                  } else {
                    update["$set"][path.toString() + "._value"] = value2;
                  }
                }

                if (valueType2 !== valueType1)
                  update["$set"][path.toString() + "._type"] = valueType2;

                if (valueTimestamp2 !== valueTimestamp1) {
                  update["$set"][path.toString() + "._timestamp"] = new Date(
                    valueTimestamp2,
                  );
                }

                break;
              case "object":
                if (!diff[1]?.object || object2 !== object1) {
                  update["$set"][
                    path.length ? path.toString() + "._object" : "_object"
                  ] = !!object2;
                }

                break;
              case "writable":
                if (!diff[1]?.writable || writable2 !== writable1) {
                  update["$set"][
                    path.length ? path.toString() + "._writable" : "_writable"
                  ] = !!writable2;
                }

                break;
              case "notification":
                if (
                  !diff[1] ||
                  !diff[1].notification ||
                  notification2 !== notification1
                ) {
                  update["$set"][
                    path.length
                      ? path.toString() + "._notification"
                      : "_notification"
                  ] = notification2;
                }

                if (attributesTimestamp2 !== attributesTimestamp1) {
                  update["$set"][path.toString() + "._attributesTimestamp"] =
                    new Date(attributesTimestamp2);
                }

                break;
              case "accessList":
                if (
                  !diff[1] ||
                  !diff[1].accessList ||
                  !compareAccessLists(accessList2, accessList1)
                ) {
                  update["$set"][
                    path.length
                      ? path.toString() + "._accessList"
                      : "_accessList"
                  ] = accessList2;
                }

                if (attributesTimestamp2 !== attributesTimestamp1) {
                  update["$set"][path.toString() + "._attributesTimestamp"] =
                    new Date(attributesTimestamp2);
                }
            }
          }
        }

        if (diff[1]) {
          for (const attrName of Object.keys(diff[1])) {
            if (
              diff[1][attrName][1] != null &&
              diff[2]?.[attrName]?.[1] == null
            ) {
              const p = path.length ? path.toString() + "." : "";
              update["$unset"][`${p}_${attrName}`] = 1;
              if (attrName === "value") {
                update["$unset"][p + "_type"] = 1;
                update["$unset"][p + "_timestamp"] = 1;
              } else if (attrName === "notification") {
                if (accessList2 == null)
                  update["$unset"][`${p}_attributesTimestamp`] = 1;
              } else if (attrName === "accessList") {
                if (notification2 == null)
                  update["$unset"][`${p}_attributesTimestamp`] = 1;
              }
            }
          }
        }
    }
  }

  update["$unset"] = optimizeProjection(update["$unset"]);

  // Remove overlap possibly caused by parameters changing from objects
  // to regular parameters or vice versa. Reason being that _timestamp
  // represents two different things depending on whether the parameter
  // is an object or not.
  for (const k of Object.keys(update["$unset"]))
    if (update["$set"][k] != null) delete update["$unset"][k];

  // Remove empty keys
  for (const [k, v] of Object.entries(update)) {
    if (k === "$addToSet") {
      for (const [kk, vv] of Object.entries(v))
        if (!vv["$each"].length) delete v[kk];
    } else if (k === "$pull") {
      for (const [kk, vv] of Object.entries(v))
        if (!vv["$in"].length) delete v[kk];
    }
    if (!Object.keys(v).length) delete update[k];
  }

  if (!Object.keys(update).length) return;

  // Mongo doesn't allow $addToSet and $pull at the same time
  let update2;
  if (update["$addToSet"] && update["$pull"]) {
    update2 = { $pull: update["$pull"] };
    delete update["$pull"];
  }

  const result = await collections.devices.updateOne(
    { _id: deviceId },
    update,
    {
      upsert: isNew,
    },
  );

  if (!result.matchedCount && !result.upsertedCount)
    throw new Error(`Device ${deviceId} not found in database`);

  if (update2) {
    await collections.devices.updateOne({ _id: deviceId }, update2);
    return;
  }
}

export async function getFaults(
  deviceId: string,
): Promise<{ [channel: string]: SessionFault }> {
  const res = await collections.faults
    .find({ _id: { $regex: `^${escapeRegExp(deviceId)}\\:` } })
    .toArray();

  const faults: { [channel: string]: SessionFault } = {};
  for (const r of res) {
    const channel = r._id.slice(deviceId.length + 1);
    const fault: SessionFault = {
      code: r.code,
      message: r.message,
      ...(r.detail && { detail: r.detail }),
      timestamp: +r.timestamp,
      provisions: JSON.parse(r.provisions),
      retries: r.retries,
      ...(r.expiry && { expiry: +r.expiry }),
    };
    faults[channel] = fault;
  }

  return faults;
}

export async function saveFault(
  deviceId: string,
  channel: string,
  fault: SessionFault,
): Promise<void> {
  const id = `${deviceId}:${channel}`;
  const f: MongoTypes.Fault = {
    _id: id,
    device: deviceId,
    channel: channel,
    timestamp: new Date(fault.timestamp),
    code: fault.code,
    message: fault.message,
    ...(fault.detail && { detail: fault.detail }),
    retries: fault.retries,
    ...(fault.expiry && { expiry: new Date(fault.expiry) }),
    provisions: JSON.stringify(fault.provisions),
  };
  await collections.faults.replaceOne({ _id: id }, f, { upsert: true });
}

export async function deleteFault(
  deviceId: string,
  channel: string,
): Promise<void> {
  await collections.faults.deleteOne({ _id: `${deviceId}:${channel}` });
}

export async function getDueTasks(
  deviceId: string,
  timestamp: number,
): Promise<[Task[], number]> {
  const cur = collections.tasks
    .find({ device: deviceId })
    .sort({ timestamp: 1 });
  const tasks = [] as Task[];

  for await (const t of cur) {
    if (+t.timestamp >= timestamp) return [tasks, +t.timestamp];
    const task: Task = {
      _id: t._id.toString(),
      name: t.name,
      ...(t.timestamp && { timestamp: +t.timestamp }),
      ...(t.expiry && { expiry: +t.expiry }),
      ...(t.name === "getParameterValues" && {
        parameterNames: t.parameterNames,
      }),
      ...(t.name === "setParameterValues" && {
        parameterValues: t.parameterValues,
      }),
      ...(t.name === "refreshObject" && {
        objectName: t.objectName,
      }),
      ...(t.name === "download" && {
        fileType: t.fileType,
        fileName: t.fileName,
        targetFileName: t.targetFileName,
      }),
      ...(t.name === "addObject" && {
        objectName: t.objectName,
        parameterValues: t.parameterValues,
      }),
      ...(t.name === "deleteObject" && {
        objectName: t.objectName,
      }),
      ...(t.name === "provisions" && {
        provisions: t.provisions,
      }),
    };

    tasks.push(task);

    // For API compatibility
    if (task.name === "download" && t["file"]) {
      let q;
      if (ObjectId.isValid(t["file"]))
        q = { _id: { $in: [t["file"], new ObjectId(t["file"])] } };
      else q = { _id: t["file"] };

      const res = await collections.files.find(q).toArray();

      if (res[0]) {
        if (!task.fileType) task.fileType = res[0].metadata.fileType;

        if (!task.fileName)
          task.fileName = res[0].filename || res[0]._id.toString();
      }
    }
  }
  return [tasks, null];
}

export async function clearTasks(
  deviceId: string,
  taskIds: string[],
): Promise<void> {
  await collections.tasks.deleteMany({
    _id: { $in: taskIds.map((id) => new ObjectId(id)) },
  });
}

export async function getOperations(
  deviceId: string,
): Promise<{ [commandKey: string]: Operation }> {
  const res = await collections.operations
    .find({ _id: { $regex: `^${escapeRegExp(deviceId)}\\:` } })
    .toArray();

  const operations: { [commandKey: string]: Operation } = {};
  for (const r of res) {
    const commandKey = r._id.slice(deviceId.length + 1);
    // Workaround for a bug in v1.2.1 where operation object is saved without deserialization
    if (typeof r.provisions !== "string") {
      delete r._id;
      operations[commandKey] = r as unknown as Operation;
      continue;
    }
    const operation: Operation = {
      name: r.name,
      timestamp: +r.timestamp,
      channels:
        typeof r.channels === "string" ? JSON.parse(r.channels) : r.channels,
      retries: JSON.parse(r.retries),
      provisions: JSON.parse(r.provisions),
      ...(r.args && { args: JSON.parse(r.args) }),
    };
    operations[commandKey] = operation;
  }
  return operations;
}

export async function saveOperation(
  deviceId: string,
  commandKey: string,
  operation: Operation,
): Promise<void> {
  const id = `${deviceId}:${commandKey}`;
  const o: MongoTypes.Operation = {
    _id: id,
    name: operation.name,
    timestamp: new Date(operation.timestamp),
    channels: JSON.stringify(operation.channels),
    provisions: JSON.stringify(operation.provisions),
    retries: JSON.stringify(operation.retries),
    args: JSON.stringify(operation.args),
  };
  await collections.operations.replaceOne({ _id: id }, o, {
    upsert: true,
  });
}

export async function deleteOperation(
  deviceId: string,
  commandKey: string,
): Promise<void> {
  await collections.operations.deleteOne({ _id: `${deviceId}:${commandKey}` });
}
