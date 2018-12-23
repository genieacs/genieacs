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

function get(name) {
  if (name === "parameter") return parameter;
  else if (name === "parameter-list") return parameterList;
  else if (name === "parameter-table") return parameterTable;
  else if (name === "overview-dot") return overviewDot;
  else if (name === "container") return container;
  else if (name === "summon-button") return summonButton;
  else if (name === "device-faults") return deviceFaults;
  else if (name === "all-parameters") return allParameters;
  else if (name === "device-actions") return deviceActions;
  else if (name === "tags") return tags;
  else if (name === "ping") return ping;
  else throw new Error(`No such component '${name}'`);
}

export { get };
