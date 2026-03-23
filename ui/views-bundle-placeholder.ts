declare module "views-bundle" {
  const views: Record<string, (...args: unknown[]) => unknown>;
  export default views;
}
