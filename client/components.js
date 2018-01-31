"use strict";

import parameter from "./components/parameter";
import parameterList from "./components/parameter-list";
import parameterTable from "./components/parameter-table";
import overviewDot from "./components/overview-dot";

function get(name) {
  if (name === "parameter") return parameter;
  else if (name === "parameter-list") return parameterList;
  else if (name === "parameter-table") return parameterTable;
  else if (name === "overview-dot") return overviewDot;
  else throw new Error(`No such component '${name}'`);
}

export { get };
