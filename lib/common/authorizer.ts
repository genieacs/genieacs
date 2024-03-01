import { PermissionSet, Expression } from "../types.ts";
import { evaluate, or } from "./expression/util.ts";

export default class Authorizer {
  private declare permissionSets: PermissionSet[];
  private declare validatorCache: WeakMap<
    any,
    (mutationType, mutation, any) => boolean
  >;
  private declare hasAccessCache: Map<string, boolean>;
  private declare getFilterCache: Map<string, Expression>;

  public constructor(permissionSets: PermissionSet[]) {
    this.permissionSets = permissionSets;
    this.validatorCache = new WeakMap();
    this.hasAccessCache = new Map();
    this.getFilterCache = new Map();
  }

  public hasAccess(resourceType: string, access: number): boolean {
    const cacheKey = `${resourceType}-${access}`;
    if (this.hasAccessCache.has(cacheKey))
      return this.hasAccessCache.get(cacheKey);

    let has = false;
    for (const permissionSet of this.permissionSets) {
      for (const perm of permissionSet) {
        if (perm[resourceType]) {
          if (perm[resourceType].access >= access) {
            has = true;
            break;
          }
        }
      }
    }

    this.hasAccessCache.set(cacheKey, has);
    return has;
  }

  public getFilter(resourceType: string, access: number): Expression {
    const cacheKey = `${resourceType}-${access}`;
    if (this.getFilterCache.has(cacheKey))
      return this.getFilterCache.get(cacheKey);

    let filter: Expression = null;
    for (const permissionSet of this.permissionSets) {
      for (const perm of permissionSet) {
        if (perm[resourceType]) {
          if (perm[resourceType].access >= access)
            filter = or(filter, perm[resourceType].filter);
        }
      }
    }

    this.getFilterCache.set(cacheKey, filter);
    return filter;
  }

  public getValidator(
    resourceType: string,
    resource: unknown,
  ): (mutationType: string, mutation?: any, args?: any) => boolean {
    if (this.validatorCache.has(resource))
      return this.validatorCache.get(resource);

    const validators: Expression[] = [];

    for (const permissionSet of this.permissionSets) {
      for (const perm of permissionSet) {
        if (
          perm[resourceType] &&
          perm[resourceType].access >= 3 &&
          perm[resourceType].validate
        )
          validators.push(perm[resourceType].validate);
      }
    }

    const validator = (
      mutationType: string,
      mutation: any,
      any: any,
    ): boolean => {
      if (!validators.length) return false;

      const object = {
        mutationType,
        mutation,
        resourceType,
        object: resource,
        options: any,
      };

      const valueFunction = (paramName): any => {
        const entry = paramName.split(".", 1)[0];
        paramName = paramName.slice(entry.length + 1);
        let value = null;
        if (["mutation", "options"].includes(entry)) {
          value = object[entry];
          for (const seg of paramName.split(".")) {
            if (value == null) break;
            if (typeof value !== "object") value = null;
            else value = value[seg];
          }
        } else if (object[entry]) {
          if (paramName) value = object[entry][paramName];
          else value = object[entry];
        }

        return value;
      };

      const res = evaluate(
        validators.length > 1 ? ["OR", validators] : validators[0],
        valueFunction,
        Date.now(),
      );
      return !Array.isArray(res) && !!res;
    };

    this.validatorCache.set(resource, validator);
    return validator;
  }

  public getPermissionSets(): PermissionSet[] {
    return this.permissionSets;
  }
}
