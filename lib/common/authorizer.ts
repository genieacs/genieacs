import { PermissionSet } from "../types.ts";
import Expression from "./expression.ts";

export default class Authorizer {
  declare private permissionSets: PermissionSet[];
  declare private validatorCache: WeakMap<
    any,
    (mutationType, mutation, any) => boolean
  >;
  declare private hasAccessCache: Map<string, boolean>;
  declare private getFilterCache: Map<string, Expression>;

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

    let filter: Expression = new Expression.Literal(false);
    for (const permissionSet of this.permissionSets) {
      for (const perm of permissionSet) {
        if (perm[resourceType]) {
          if (perm[resourceType].access >= access)
            filter = Expression.or(filter, perm[resourceType].filter);
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

    let validators: Expression = new Expression.Literal(false);

    for (const permissionSet of this.permissionSets) {
      for (const perm of permissionSet) {
        if (
          perm[resourceType] &&
          perm[resourceType].access >= 3 &&
          perm[resourceType].validate
        )
          validators = Expression.or(validators, perm[resourceType].validate);
      }
    }

    const validator = (
      mutationType: string,
      mutation: any,
      any: any,
    ): boolean => {
      const object = {
        mutationType,
        mutation,
        resourceType,
        object: resource,
        options: any,
      };

      const now = Date.now();
      const res = validators.evaluate((exp) => {
        if (exp instanceof Expression.Literal) return exp;
        if (exp instanceof Expression.Parameter) {
          if (exp.path.colon) return new Expression.Literal(null);
          const entry = exp.path.segments[0] as string;
          const paramName = exp.path.slice(1);
          let value = null;
          if (["mutation", "options"].includes(entry)) {
            value = object[entry];
            for (const seg of paramName.segments) {
              if (value == null) break;
              if (typeof value !== "object") value = null;
              else value = value[seg as string];
            }
          } else if (object[entry]) {
            if (paramName.length) value = object[entry][paramName.toString()];
            else value = object[entry];
          }
          return new Expression.Literal(value);
        } else if (exp instanceof Expression.FunctionCall) {
          if (exp.name === "NOW") return new Expression.Literal(now);
        }
        return new Expression.Literal(null);
      }).value;

      return !!res;
    };

    this.validatorCache.set(resource, validator);
    return validator;
  }

  public getPermissionSets(): PermissionSet[] {
    return this.permissionSets;
  }
}
