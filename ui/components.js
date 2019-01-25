"use strict";

import parameter from "./components/parameter";
import parameterList from "./components/parameter-list";
import parameterTable from "./components/parameter-table";
import overviewDot from "./components/overview-dot";
import container from "./components/container";
import summonButton from "./components/summon-button";
import deviceFaults from "./components/device-faults";
import allParameters from "./components/all-parameters";
import deviceActions from "./components/device-actions";
import tags from "./components/tags";
import ping from "./components/ping";
import deviceLink from "./components/device-link";

const comps = {
  parameter,
  "parameter-list": parameterList,
  "parameter-table": parameterTable,
  "overview-dot": overviewDot,
  container,
  "summon-button": summonButton,
  "device-faults": deviceFaults,
  "all-parameters": allParameters,
  "device-actions": deviceActions,
  tags,
  ping,
  "device-link": deviceLink
};

export function get(name) {
  const c = comps[name];
  if (!c) throw new Error(`No such component '${name}'`);
  return c;
}
