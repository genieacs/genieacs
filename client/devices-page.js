"use strict";

import m from "mithril";

import config from "./config";
import filterComponent from "./filter-component";

function load(filter, limit) {
  return new Promise((resolve, reject) => {
    m
      .request({
        url: "/api/devices/",
        data: { filter: filter, limit: limit }
      })
      .then(res => {
        resolve(res);
      })
      .catch(err => {
        err.message = err.message || "Unknown error";
        reject(err);
      });
  });
}

function count(filter, limit) {
  return new Promise((resolve, reject) => {
    function extract(xhr) {
      return +xhr.getResponseHeader("x-total-count");
    }
    m
      .request({
        method: "HEAD",
        url:
          "/api/devices/?" +
          m.buildQueryString({ filter: filter, limit: limit }),
        extract: extract
      })
      .then(res => {
        resolve(res);
      })
      .catch(err => {
        err.message = err.message || "Unknown error";
        reject(err);
      });
  });
}

function preprocessFilter(filter) {
  if (Array.isArray(filter)) {
    filter = filter.map(f => {
      f = f.trim();
      if (f.startsWith("(")) return f;

      let match = f.match(/([^=<>]+)([=<>]+)(.+)/);

      let param = match[1].trim();
      let op = match[2].trim();
      let value = match[3].trim();

      try {
        value = JSON.parse(value);
      } catch (err) {
        // eslint-disable-line no-empty
      }

      for (let cf of config.filter)
        if (param === cf.label) param = cf.parameter;

      if (param === "tag") {
        let tag = value.replace(/[^a-zA-Z0-9]/g, "_");
        if (op === "=") return `Tags.${tag} is not null`;
        else if (op === "<>") return `Tags.${tag} is null`;
      }

      return `${param} ${op} ${JSON.stringify(value)}`;
    });
    filter = "(" + filter.join(") AND (") + ")";
  }
  return filter;
}

function init(args) {
  return new Promise((resolve, reject) => {
    let filter = preprocessFilter(args.filter);

    Promise.all([count(filter), load(filter, config.pageSize)])
      .then(res => {
        resolve({ filter: args.filter, total: res[0], devices: res[1] });
      })
      .catch(reject);
  });
}

function renderTable(devices, parameters, total, showMoreCallback) {
  let labels = [];
  for (let param of parameters) labels.push(m("th", param.label));

  let rows = [];
  for (let device of devices)
    rows.push(
      m(
        "tr",
        parameters.map(p => {
          if (!device[p.parameter] || !device[p.parameter].value)
            return m("td.na");
          if (!device[p.parameter].value[0] === "") return m("td.blank");
          return m("td", device[p.parameter].value[0]);
        })
      )
    );

  let footerElements = [`${devices.length}/${total}`];

  if (devices.length < total)
    footerElements.push(m("a", { onclick: showMoreCallback }, "Show more"));

  let tfoot = m(
    "tfoot",
    m("tr", m("td", { colspan: labels.length }, footerElements))
  );

  return m("table.table", [
    m("thead", m("tr", labels)),
    m("tbody", rows),
    tfoot
  ]);
}

const component = {
  view: vnode => {
    document.title = "Devices - GenieACS";
    function showMore() {
      const lastDevice = vnode.attrs.devices[vnode.attrs.devices.length - 1];
      let f = (vnode.attrs.filter || []).concat(
        `DeviceID.ID > "${lastDevice["DeviceID.ID"].value[0]}"`
      );
      load(preprocessFilter(f), config.pageSize).then(res => {
        vnode.attrs.devices = vnode.attrs.devices.concat(res);
        if (res.length < config.pageSize)
          vnode.attrs.total = vnode.attrs.devices.length;
      });
    }
    return [
      m("h1", "Listing devices"),
      m(filterComponent, { filterList: [].concat(vnode.attrs.filter) }),
      renderTable(
        vnode.attrs.devices,
        config.index,
        vnode.attrs.total,
        showMore
      )
    ];
  }
};

export { init, component };
