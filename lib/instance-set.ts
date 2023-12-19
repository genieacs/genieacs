interface Instance {
  [name: string]: string;
}

export default class InstanceSet {
  private declare set: Set<Instance>;

  public constructor() {
    this.set = new Set();
  }

  public add(instance: Instance): void {
    this.set.add(instance);
  }

  public delete(instance: Instance): void {
    this.set.delete(instance);
  }

  public superset(instance: Instance): Instance[] {
    const res = [];
    for (const inst of this.set) {
      let match = true;
      for (const k in instance) {
        if (inst[k] !== instance[k]) {
          match = false;
          break;
        }
      }

      if (match) res.push(inst);
    }

    res.sort((a, b) => {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return keysB.length - keysA.length;

      keysA.sort();
      keysB.sort();

      for (let i = 0; i < keysA.length; ++i) {
        if (keysA[i] > keysB[i]) return 1;
        else if (keysA[i] < keysB[i]) return -1;
        else if (a[keysA[i]] > b[keysB[i]]) return 1;
        else if (a[keysA[i]] < b[keysB[i]]) return -1;
      }

      return 0;
    });

    return res;
  }

  public subset(instance: Instance): Instance[] {
    const res = [];

    for (const inst of this.set) {
      let match = true;
      for (const k in inst) {
        if (inst[k] !== instance[k]) {
          match = false;
          break;
        }
      }

      if (match) res.push(inst);
    }

    res.sort((a, b) => {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return keysA.length - keysB.length;

      keysA.sort();
      keysB.sort();

      for (let i = 0; i < keysA.length; ++i) {
        if (keysA[i] > keysB[i]) return 1;
        else if (keysA[i] < keysB[i]) return -1;
        else if (a[keysA[i]] > b[keysB[i]]) return 1;
        else if (a[keysA[i]] < b[keysB[i]]) return -1;
      }

      return 0;
    });

    return res;
  }

  public [Symbol.iterator](): IterableIterator<Instance> {
    return this.set.values();
  }

  public forEach(callback: (instance: Instance) => void): void {
    this.set.forEach(callback);
  }

  public values(): IterableIterator<Instance> {
    return this.set.values();
  }

  public clear(): void {
    this.set.clear();
  }

  public get size(): number {
    return this.set.size;
  }
}
