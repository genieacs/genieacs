import Expression from "../lib/common/expression.ts";
export const configSnapshot = window.configSnapshot;
export const genieacsVersion = window.genieacsVersion;

type Filters = { label: string; parameter: Expression; type: string }[];
type pageSize = number;
type overview = {
  charts: {
    [name: string]: {
      label: string;
      slices: {
        label: string;
        filter: Expression;
        color: string;
      }[];
    };
  };
  groups: {
    label: string;
    charts: string[];
  }[];
};

type Index = {
  label: string;
  type?: string;
  parameter: Expression;
  unsortable: boolean;
  raw: NestedRecord;
}[];

type NestedRecord = { [k: string]: Expression | NestedRecord };

const conf: NestedRecord = {};
for (const [key, value] of Object.entries(window.clientConfig)) {
  const exp = Expression.parse(value).evaluate((e) => e);
  let ref = conf;
  const keyParts = key.split(".");
  while (keyParts.length > 1) {
    const k = keyParts.shift();
    if (ref[k] == null || typeof ref[k] !== "object") ref[k] = {};
    ref = ref[k] as NestedRecord;
  }
  ref[keyParts[0]] = exp;
}

export const filters: Filters = [];
export let pageSize: number = 10;
export const overview: overview = { charts: {}, groups: [] };
export const index: Index = [];
export let device: NestedRecord = {};

for (const obj of Object.values(conf["filters"] || {})) {
  let label = "";
  let parameter: Expression = new Expression.Literal(false);
  let type = "string";
  if (obj["label"] instanceof Expression.Literal)
    label = obj["label"].value as string;
  if (obj["parameter"] instanceof Expression) parameter = obj["parameter"];
  if (obj["type"] instanceof Expression.Literal)
    type = obj["type"].value as string;
  filters.push({ label, parameter, type });
}

for (const obj of Object.values(conf["index"] || {})) {
  let label = "";
  let parameter: Expression = new Expression.Literal(null);
  let unsortable = false;
  let type = "";
  if (obj["label"] instanceof Expression.Literal)
    label = obj["label"].value as string;
  if (obj["type"] instanceof Expression.Literal)
    type = obj["type"].value as string;
  if (obj["parameter"] instanceof Expression) parameter = obj["parameter"];
  if (obj["unsortable"] instanceof Expression.Literal)
    unsortable = obj["unsortable"].value as boolean;
  index.push({ label, type, parameter, unsortable, raw: obj });
}

for (const obj of Object.values(conf["overview"]?.["groups"] || {})) {
  let label = "";
  const charts: string[] = [];
  if (obj["label"] instanceof Expression.Literal)
    label = obj["label"].value as string;
  for (const chart of Object.values(obj["charts"] || {})) {
    if (chart instanceof Expression.Literal) charts.push(chart.value as string);
  }
  overview.groups.push({ label, charts });
}

for (const [name, obj] of Object.entries(conf["overview"]?.["charts"] || {})) {
  const slices: { label: string; filter: Expression; color: string }[] = [];
  for (const slice of Object.values(obj["slices"] || {})) {
    let label = "";
    let filter: Expression = new Expression.Literal(false);
    let color = "";
    if (slice["label"] instanceof Expression.Literal)
      label = slice["label"].value as string;
    if (slice["filter"] instanceof Expression) filter = slice["filter"];
    if (slice["color"] instanceof Expression.Literal)
      color = slice["color"].value as string;
    slices.push({ label, filter, color });
  }
  let label = "";
  if (obj["label"] instanceof Expression.Literal)
    label = obj["label"].value as string;
  overview.charts[name] = { label, slices };
}

if (conf["pageSize"] instanceof Expression.Literal)
  pageSize = +conf["pageSize"].value || 10;

device = conf["device"] as NestedRecord;
