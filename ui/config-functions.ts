interface Config {
  _id: string;
  value: string;
}

interface Diff {
  add: Config[];
  remove: string[];
}

export function flattenConfig(config): any {
  const flatten = {};
  const recuresive = (obj: any, root: string): void => {
    for (const [k, v] of Object.entries(obj)) {
      const key = root ? `${root}.${k}` : k;
      if (v === undefined) continue;
      if (v === null || typeof v !== "object") flatten[key] = v;
      else recuresive(v, key);
    }
  };

  if (config !== null && typeof config === "object") recuresive(config, "");
  return flatten;
}

export function structureConfig(config: Config[]): any {
  config.sort((a, b) => (a._id > b._id ? 1 : a._id < b._id ? -1 : 0));
  const _config = {};
  for (const c of config) {
    const keys = c._id.split(".");
    let ref = _config;
    while (keys.length > 1) {
      const k = keys.shift();
      if (typeof ref[k] !== "object") ref[k] = {};
      ref = ref[k];
    }
    ref[keys[0]] = c.value;
  }

  const toArray = function(object): any {
    const MAX_BITS = 30;
    const MAX_ARRAY_SIZE = MAX_BITS * 10;

    if (object == null || typeof object !== "object") return object;

    if (Object.keys(object).length <= MAX_ARRAY_SIZE) {
      let indexes = [];
      for (const key of Object.keys(object)) {
        const idx = Math.floor(+key);
        if (idx >= 0 && idx < MAX_ARRAY_SIZE && String(idx) === key) {
          const pos = Math.floor(idx / MAX_BITS);
          if (!indexes[pos]) indexes[pos] = 0;
          indexes[pos] |= 1 << idx % MAX_BITS;
        } else {
          indexes = [];
          break;
        }
      }

      let index = 0;
      while (indexes.length && (index = indexes.shift()) === 1073741823);

      if (index && (~index & (index + 1)) === index + 1) {
        // its an array
        const array = [];
        for (let i = 0; i < Object.keys(object).length; i++)
          array[i] = object[i];

        object = array;
      }
    }

    for (const [k, v] of Object.entries(object)) object[k] = toArray(v);
    return object;
  };

  return toArray(_config);
}

export function diffConfig(current, target): Diff {
  const diff = {
    add: [],
    remove: []
  };

  for (const [k, v] of Object.entries(target))
    if (!current[k] || current[k] !== v) diff.add.push({ _id: k, value: v });

  for (const k of Object.keys(current)) if (!target[k]) diff.remove.push(k);

  return diff;
}
