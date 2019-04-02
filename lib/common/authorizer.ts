import { PermissionSet, Expression } from "../types";
import { evaluate } from "./expression";

export default class Authorizer {
  private permissionSets: PermissionSet[];
  private validatorCache: WeakMap<
    object,
    (mutationType, mutation, any) => boolean
  >;
  private hasAccessCache: Map<string, boolean>;

  public constructor(permissionSets) {
    this.permissionSets = permissionSets;
    this.validatorCache = new WeakMap();
    this.hasAccessCache = new Map();
  }

  public hasAccess(resourceType, access): boolean {
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

  public getValidator(
    resourceType,
    resource
  ): (mutationType: string, mutation: any, args: any) => boolean {
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
      any: any
    ): boolean => {
      if (!validators.length) return false;

      const object = {
        mutationType,
        mutation,
        resourceType,
        object: resource,
        options: any
      };

      const valueFunction = (paramName): any => {
        const entry = paramName.split(".", 1)[0];
        paramName = paramName.slice(entry.length + 1);
        let value = null;
        if (["mutation", "options"].includes(entry)) {
          value = object[entry];
          for (const seg of paramName.split(".")) {
            // typeof null is "object"
            if (value != null && typeof value !== "object") value = null;
            else value = value[seg];
            if (value == null) break;
          }
        } else if (object[entry]) {
          value = object[entry][paramName];
        }

        return value;
      };

      const res = evaluate(
        validators.length > 1 ? ["OR", validators] : validators[0],
        valueFunction,
        Date.now()
      );
      return !Array.isArray(res) && !!res;
    };

    this.validatorCache.set(resource, validator);
    return validator;
  }
}
