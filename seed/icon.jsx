// SVG icon library component.
//
// Attributes:
//   name  - Icon name (see available icons below)
//   class - CSS classes to apply to the SVG element
//
// Available icons:
//   add, add-instance, close, delete-instance, edit, menu,
//   refresh, remove, retry, sorted-asc, sorted-dsc, unsorted
//
// Example:
//   <icon name="edit" class="h-4 w-4 text-cyan-700" />

const iconName = node.attributes.name.get();

const icons = {
  "add-instance": [
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />,
    <path d="M12 8v8M8 12h8" />,
  ],
  add: [<path d="M12 5v14M5 12h14" />],
  close: [<path d="M6 18 18 6M6 6l12 12" />],
  "delete-instance": [
    <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />,
    <path d="M8 12h8" />,
  ],
  edit: [<path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4z" />],
  menu: [<path d="M4 6h16M4 12h16M4 18h16" />],
  refresh: [
    <path d="M23 4v6h-6" />,
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />,
  ],
  remove: [<path d="M18 6 6 18M6 6l12 12" />],
  retry: [
    <path d="m17 1 4 4-4 4" />,
    <path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4" />,
    <path d="M21 13v2a4 4 0 0 1-4 4H3" />,
  ],
  "sorted-asc": [<path d="M4 12h10M4 18h16M4 6h4" />],
  "sorted-dsc": [<path d="M4 12h10M4 6h16M4 18h4" />],
  unsorted: [<path d="M4 18h10M4 12h16M4 6h6" />],
};

const content = icons[iconName];
// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
if (!content) return null;

const attrs = {
  xmlns: "http://www.w3.org/2000/svg",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "2",
  class: node.attributes.class?.get(),
  "aria-hidden": "true",
  viewBox: "0 0 24 24",
};

// @ts-expect-error: top-level return (script is wrapped in a function at runtime)
return <svg {...attrs}>{content}</svg>;
