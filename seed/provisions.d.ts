interface Timestamps {
  path?: number;
  object?: number;
  writable?: number;
  value?: number;
  notification?: number;
  accessList?: number;
}

interface Values {
  path?: number | [number, number];
  object?: boolean;
  writable?: boolean;
  value?: string | number | boolean | [string | number | boolean, string?];
  notification?: number;
  accessList?: string[];
}

interface ParameterWrapper extends Iterable<ParameterWrapper> {
  readonly path: string | undefined;
  readonly size: number | undefined;
  readonly object: 0 | 1 | undefined;
  readonly writable: 0 | 1 | undefined;
  readonly value: [string | number | boolean, string] | undefined;
  readonly notification: number | undefined;
  readonly accessList: string[] | undefined;
}

declare function declare(
  path: string,
  timestamps?: Timestamps | null,
  values?: Values | null,
): ParameterWrapper;

declare function clear(
  path: string,
  timestamp: number,
  attributes?: Timestamps,
): void;

declare function commit(): void;

declare function ext(...args: unknown[]): unknown;

declare function log(msg: string, meta?: Record<string, unknown>): void;

declare const args: unknown[];

interface DateConstructor {
  new (): Date;
  new (
    year: number,
    monthIndex?: number,
    day?: number,
    hours?: number,
    minutes?: number,
    seconds?: number,
    milliseconds?: number,
  ): Date;
  now(intervalOrCron?: number | string, variance?: number): number;
  parse(dateString: string): number;
  UTC(
    year: number,
    monthIndex?: number,
    day?: number,
    hours?: number,
    minutes?: number,
    seconds?: number,
    milliseconds?: number,
  ): number;
}
