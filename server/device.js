"use strict";

function recursive(input, root, output, timestamp) {
  for (let [name, tree] of Object.entries(input)) {
    if (root.length === 0)
      if (name === "_lastInform") {
        output["Events.Inform"] = {
          value: [timestamp, "xsd:dateTime"],
          valueTimestamp: timestamp,
          writable: false,
          writableTimestamp: timestamp,
          object: false,
          objectTimestamp: timestamp
        };
      } else if (name === "_registered") {
        output["Events.Registered"] = {
          value: [timestamp, "xsd:dateTime"],
          valueTimestamp: timestamp,
          writable: false,
          writableTimestamp: timestamp,
          object: false,
          objectTimestamp: timestamp
        };
      } else if (name === "_lastBoot") {
        output["Events.1_BOOT"] = {
          value: [timestamp, "xsd:dateTime"],
          valueTimestamp: timestamp,
          writable: false,
          writableTimestamp: timestamp,
          object: false,
          objectTimestamp: timestamp
        };
      } else if (name === "_lastBootstrap") {
        output["Events.0_BOOTSTRAP"] = {
          value: [timestamp, "xsd:dateTime"],
          valueTimestamp: timestamp,
          writable: false,
          writableTimestamp: timestamp,
          object: false,
          objectTimestamp: timestamp
        };
      } else if (name === "_id") {
        output["DeviceID.ID"] = {
          value: [tree, "xsd:string"],
          valueTimestamp: timestamp,
          writable: false,
          writableTimestamp: timestamp,
          object: false,
          objectTimestamp: timestamp
        };
      } else if (name === "_deviceId") {
        output["DeviceID.Manufacturer"] = {
          value: [tree["_Manufacturer"], "xsd:string"],
          valueTimestamp: timestamp,
          writable: false,
          writableTimestamp: timestamp,
          object: false,
          objectTimestamp: timestamp
        };
        output["DeviceID.OUI"] = {
          value: [tree["_OUI"], "xsd:string"],
          valueTimestamp: timestamp,
          writable: false,
          writableTimestamp: timestamp,
          object: false,
          objectTimestamp: timestamp
        };
        output["DeviceID.ProductClass"] = {
          value: [tree["_ProductClass"], "xsd:string"],
          valueTimestamp: timestamp,
          writable: false,
          writableTimestamp: timestamp,
          object: false,
          objectTimestamp: timestamp
        };
        output["DeviceID.SerialNumber"] = {
          value: [tree["_SerialNumber"], "xsd:string"],
          valueTimestamp: timestamp,
          writable: false,
          writableTimestamp: timestamp,
          object: false,
          objectTimestamp: timestamp
        };
      } else if (name === "_tags") {
        output["Tags"] = {
          writable: true,
          writableTimestamp: timestamp,
          object: true,
          objectTimestamp: timestamp
        };

        for (let t of tree)
          output[`Tags.${t}`] = {
            value: [true, "xsd:boolean"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
      }

    if (name.startsWith("_")) continue;

    let childrenTimestamp = timestamp;

    if (root.length === 0) childrenTimestamp = input["_timestamp"] || 1;
    else if (input["_timestamp"] > timestamp)
      childrenTimestamp = input["_timestamp"];

    const attrs = {};
    if (tree["_value"]) {
      attrs["value"] = [tree["_value"], tree["_type"]];
      attrs["valueTimestamp"] = childrenTimestamp;
      attrs["object"] = false;
      attrs["objectTimestamp"] = childrenTimestamp;
    } else if (tree["_object"]) {
      attrs["object"] = tree["_object"];
      attrs["objectTimestamp"] = childrenTimestamp;
    }

    if (tree["_writable"]) {
      attrs["writable"] = tree["_writable"];
      attrs["writableTimestamp"] = childrenTimestamp;
    }

    let r = root.concat(name);
    output[r.join(".")] = attrs;

    if (attrs["object"]) recursive(tree, r, output, childrenTimestamp);
  }
}

function transpose(device) {
  const newDevice = {};
  const timestamp = new Date(device["_lastInform"] || 1).getTime();
  recursive(device, [], newDevice, timestamp);
  return newDevice;
}

function transposeQuery(query) {
  const newQuery = {};

  for (let [key, val] of Object.entries(query))
    if (key.startsWith("$")) newQuery[key] = transposeQuery(val);
    else if (key === "DeviceID.ID") newQuery["_id"] = val;

  return newQuery;
}

exports.transpose = transpose;
exports.transposeQuery = transposeQuery;
