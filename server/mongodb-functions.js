"use strict";
const mongodb = require("mongodb");
const expressionParser = require("../common/expression-parser");
const expression = require("../common/expression");

function processDeviceFilter(filter) {
  return expressionParser.map(filter, exp => {
    if (!Array.isArray(exp)) return exp;

    if (exp[0] === "PARAM") {
      const p = exp[1];
      if (p === "DeviceID.ID") return ["PARAM", "_id"];
      else if (p === "DeviceID") return ["PARAM", "_deviceId"];
      else if (p.startsWith("DeviceID."))
        return ["PARAM", "_deviceId._" + p.slice(9)];
      else if (p === "Tags") return ["PARAM", "_tags"];
      else if (p === "tag") return ["PARAM", "_tags"];
      else if (p === "Events.Inform") return ["PARAM", "_lastInform"];
      else if (p === "Events.Registered") return ["PARAM", "_registered"];
      else if (p === "Events.0_BOOTSTRAP") return ["PARAM", "_lastBootstrap"];
      else if (p === "Events.1_BOOT") return ["PARAM", "_lastBoot"];
    } else if (
      Array.isArray(exp[1]) &&
      exp[1][0] === "PARAM" &&
      exp[1][1].startsWith("Tags.")
    ) {
      const t = exp[1][1].slice(5);
      if (exp[0] === "IS NULL") return ["<>", ["PARAM", "_tags"], t];
      else if (exp[0] === "IS NOT NULL") return ["=", ["PARAM", "_tags"], t];
      else if (exp[0] === "=" && exp[2] === true)
        return ["=", ["PARAM", "_tags"], t];
    } else if (["=", "<>", ">", ">=", "<", "<="].includes(exp[0])) {
      let e = exp.slice();
      if (
        Array.isArray(exp[1]) &&
        exp[1][0] === "PARAM" &&
        typeof exp[1][1] === "string" &&
        !exp[1][1].startsWith("_")
      )
        e[1] = ["PARAM", `${exp[1][1]}._value`];
      if (typeof e[2] === "number") {
        let alt = e.slice();
        alt[2] = new Date(e[2]);
        e = ["OR", e, alt];
      }
      return e;
    }
    return exp;
  });
}

function processTasksFilter(filter) {
  return expressionParser.map(filter, exp => {
    if (!Array.isArray(exp)) return exp;
    if (["=", "<>", ">", ">=", "<", "<="].includes(exp[0])) {
      let e = exp.slice();
      if (e[1][0] === "PARAM" && e[1][1] === "_id")
        e[2] = new mongodb.ObjectID(e[2]);
      else if (e[1][0] === "PARAM" && e[1][1] === "timestamp")
        e[2] = new Date(e[2]);
      else if (e[1][0] === "PARAM" && e[1][1] === "expiry")
        e[2] = new Date(e[2]);
      return e;
    }
    return exp;
  });
}

function processFaultsFilter(filter) {
  return expressionParser.map(filter, exp => {
    if (!Array.isArray(exp)) return exp;
    if (["=", "<>", ">", ">=", "<", "<="].includes(exp[0])) {
      let e = exp.slice();
      if (e[1][0] === "PARAM" && e[1][1] === "timestamp") e[2] = new Date(e[2]);
      else if (e[1][0] === "PARAM" && e[1][1] === "expiry")
        e[2] = new Date(e[2]);
      return e;
    }
    return exp;
  });
}

function filterToMongoQuery(filter, negate = false, res = {}) {
  const op = filter[0];

  if ((!negate && op === "AND") || (negate && op === "OR")) {
    res["$and"] = res["$and"] || [];
    for (let i = 1; i < filter.length; ++i)
      res["$and"].push(filterToMongoQuery(filter[i], negate));
  } else if ((!negate && op === "OR") || (negate && op === "AND")) {
    res["$or"] = res["$or"] || [];

    for (let i = 1; i < filter.length; ++i)
      res["$or"].push(filterToMongoQuery(filter[i], negate));
  } else if (op === "NOT") {
    filterToMongoQuery(filter[1], !negate, res);
  } else if (op === "=") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p["$ne"] = filter[2];
    else p["$eq"] = filter[2];
  } else if (op === "<>") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$ne"] = filter[2];
    p["$exists"] = true;
  } else if (op === ">") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$gt"] = filter[2];
  } else if (op === ">=") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$gte"] = filter[2];
  } else if (op === "<") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$lt"] = filter[2];
  } else if (op === "<=") {
    const param = filter[1][1];
    let p = (res[param] = res[param] || {});
    if (negate) p = p["$not"] = p["$not"] || {};
    p["$lte"] = filter[2];
  } else if (op === "IS NULL") {
    const param = filter[1][1];
    res[param] = { $exists: negate };
  } else if (op === "IS NOT NULL") {
    const param = filter[1][1];
    res[param] = { $exists: !negate };
  } else if (op === "LIKE" || op === "NOT LIKE") {
    if (op === "NOT LIKE") negate = !negate;
    let param;
    let flags;
    if (filter[1][0] === "FUNC" && filter[1][1] === "UPPER") {
      if (filter[2] !== filter[2].toUpperCase())
        throw new Error(
          "Cannot compare UPPER() against non upper case pattern"
        );
      param = filter[1][2][1];
      flags = "i";
    } else if (filter[1][0] === "FUNC" && filter[1][1] === "LOWER") {
      if (filter[2] !== filter[2].toLowerCase())
        throw new Error(
          "Cannot compare LOWER() against non lower case pattern"
        );
      param = filter[1][2][1];
      flags = "i";
    } else {
      param = filter[1][1];
      flags = "";
    }
    const r = expression.likePatternToRegExp(filter[2], filter[3], flags);
    if (negate) res[param] = { $not: r };
    else res[param] = r;
  } else {
    throw new Error(`Unrecognized operator ${op}`);
  }

  return res;
}

function processDeviceProjection(projection) {
  if (!projection) return projection;
  const p = {};
  for (const [k, v] of Object.entries(projection))
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

  return p;
}

function processDeviceSort(sort) {
  if (!sort) return sort;
  const s = {};
  for (const [k, v] of Object.entries(sort))
    if (k === "DeviceID.ID") s["_id"] = v;
    else if (k === "Events.Inform") s["_lastInform"] = v;
    else s[k] = v;

  return s;
}

function flattenDevice(device) {
  function recursive(input, root, output, timestamp) {
    for (let [name, tree] of Object.entries(input)) {
      if (root.length === 0)
        if (name === "_lastInform") {
          output["Events.Inform"] = {
            value: [Date.parse(tree), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
        } else if (name === "_registered") {
          output["Events.Registered"] = {
            value: [Date.parse(tree), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
        } else if (name === "_lastBoot") {
          output["Events.1_BOOT"] = {
            value: [Date.parse(tree), "xsd:dateTime"],
            valueTimestamp: timestamp,
            writable: false,
            writableTimestamp: timestamp,
            object: false,
            objectTimestamp: timestamp
          };
        } else if (name === "_lastBootstrap") {
          output["Events.0_BOOTSTRAP"] = {
            value: [Date.parse(tree), "xsd:dateTime"],
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

      if (root.length === 0) childrenTimestamp = +(input["_timestamp"] || 1);
      else if (+input["_timestamp"] > timestamp)
        childrenTimestamp = +input["_timestamp"];

      const attrs = {};
      if (tree["_value"] != null) {
        attrs["value"] = [tree["_value"], tree["_type"]];
        attrs["valueTimestamp"] = +(tree["_timestamp"] || childrenTimestamp);
        attrs["object"] = false;
        attrs["objectTimestamp"] = childrenTimestamp;
      } else if (tree["_object"] != null) {
        attrs["object"] = tree["_object"];
        attrs["objectTimestamp"] = childrenTimestamp;
      }

      if (tree["_writable"] != null) {
        attrs["writable"] = tree["_writable"];
        attrs["writableTimestamp"] = childrenTimestamp;
      }

      let r = root.concat(name);
      output[r.join(".")] = attrs;

      if (attrs["object"]) recursive(tree, r, output, childrenTimestamp);
    }
  }

  const newDevice = {};
  const timestamp = new Date(device["_lastInform"] || 1).getTime();
  recursive(device, [], newDevice, timestamp);
  return newDevice;
}

exports.processDeviceFilter = processDeviceFilter;
exports.processTasksFilter = processTasksFilter;
exports.processFaultsFilter = processFaultsFilter;
exports.filterToMongoQuery = filterToMongoQuery;
exports.processDeviceProjection = processDeviceProjection;
exports.processDeviceSort = processDeviceSort;
exports.flattenDevice = flattenDevice;
