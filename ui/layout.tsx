import m, { ClosureComponent } from "mithril";
import drawerComponent from "./drawer-component.ts";
import * as overlay from "./overlay.ts";
import { version as VERSION } from "../package.json";
import datalist from "./datalist.ts";
import {
  transitionRoot,
  transitionChild,
  dialog,
  dialogOverlay,
  icon,
} from "./tailwind-utility-components.ts";
import * as store from "./store.ts";
import * as notifications from "./notifications.ts";
import { LOGO_SVG } from "../build/assets.ts";

function tsxComponent<T>(
  c: ClosureComponent<T>,
): (attrs: T) => ReturnType<typeof m> {
  return c as any;
}

const TransitionRoot = tsxComponent(transitionRoot);
const TransitionChild = tsxComponent(transitionChild);
const Dialog = tsxComponent(dialog);
const DialogOverlay = tsxComponent(dialogOverlay);
const Icon = tsxComponent(icon);

function classNames(...classes: string[]): string {
  return classes.filter(Boolean).join(" ");
}

interface Attrs {
  page: string;
}

const component: ClosureComponent<Attrs> = () => {
  let sidebarOpen = false;

  function setSidebarOpen(open: boolean): void {
    sidebarOpen = open;
    setTimeout(m.redraw);
  }

  return {
    view: (vnode) => {
      const navigation = [
        {
          name: "Overview",
          href: "#!/overview",
          enabled: window.authorizer.hasAccess("devices", 1),
        },
        {
          name: "Devices",
          href: "#!/devices",
          enabled: window.authorizer.hasAccess("devices", 2),
        },
        {
          name: "Faults",
          href: "#!/faults",
          enabled: window.authorizer.hasAccess("faults", 2),
        },
        {
          name: "Presets",
          href: "#!/presets",
          enabled: window.authorizer.hasAccess("presets", 2),
        },
        {
          name: "Provisions",
          href: "#!/provisions",
          enabled: window.authorizer.hasAccess("provisions", 2),
        },
        {
          name: "Virtual Parameters",
          href: "#!/virtualParameters",
          enabled: window.authorizer.hasAccess("virtualParameters", 2),
        },
        {
          name: "Files",
          href: "#!/files",
          enabled: window.authorizer.hasAccess("files", 2),
        },
        {
          name: "Config",
          href: "#!/config",
          enabled: window.authorizer.hasAccess("config", 2),
        },
        {
          name: "Permissions",
          href: "#!/permissions",
          enabled: window.authorizer.hasAccess("permissions", 2),
        },
        {
          name: "Users",
          href: "#!/users",
          enabled: window.authorizer.hasAccess("users", 2),
        },
      ]
        .filter((item) => item.enabled)
        .map(({ name, href }) => {
          const n = href.slice(3);
          return { name, href, active: vnode.attrs["page"] === n };
        });

      return [
        <div>
          <TransitionRoot show={!!sidebarOpen} duration={300}>
            <Dialog
              as="div"
              class="fixed inset-0 flex z-40 md:hidden"
              onClose={() => setSidebarOpen(false)}
            >
              <TransitionChild
                enter="transition-opacity ease-linear duration-300"
                enterFrom="opacity-0"
                enterTo="opacity-100"
                leave="transition-opacity ease-linear duration-300"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <DialogOverlay class="fixed inset-0 bg-black/50" />
              </TransitionChild>
              <TransitionChild
                enter="transition ease-in-out duration-300 transform"
                enterFrom="-translate-x-full"
                enterTo="translate-x-0"
                leave="transition ease-in-out duration-300 transform"
                leaveFrom="translate-x-0"
                leaveTo="-translate-x-full"
              >
                <div class="relative flex-1 flex flex-col max-w-xs w-full bg-white">
                  <TransitionChild
                    enter="ease-in-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in-out duration-300"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                  >
                    <div class="absolute top-0 right-0 -mr-12 pt-2">
                      <button
                        type="button"
                        class="ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-white"
                        onclick={(e) => {
                          e.redraw = false;
                          setSidebarOpen(false);
                        }}
                      >
                        <span class="sr-only">Close sidebar</span>
                        <Icon name="close" class="h-6 w-6 text-white" />
                      </button>
                    </div>
                  </TransitionChild>
                  <div class="flex-1 h-0 pt-5 pb-4 overflow-y-auto">
                    <div class="flex-shrink-0 flex items-center px-4">
                      <img class="h-10 w-auto" src={LOGO_SVG} alt="GenieACS" />
                    </div>
                    <nav class="mt-5 px-2 flex flex-col gap-1">
                      {navigation.map((item) => (
                        <a
                          key={item.name}
                          href={item.href}
                          class={classNames(
                            item.active
                              ? "bg-stone-100 text-stone-900"
                              : "text-stone-600 hover:bg-stone-50 hover:text-stone-900",
                            "group flex items-center px-2 py-2 text-base font-medium rounded-md",
                          )}
                        >
                          {item.name}
                        </a>
                      ))}
                    </nav>
                  </div>
                  <div class="p-2">
                    {window.username ? (
                      <div class="flex items-center px-2 text-stone-600 text-base">
                        {window.username}
                        <button
                          class="ml-auto text-base font-medium text-cyan-600 hover:text-cyan-500"
                          onclick={(e) => {
                            e.target.disabled = true;
                            store
                              .logOut()
                              .then(() => {
                                location.hash = "";
                                location.reload();
                              })
                              .catch((err) => {
                                e.target.disabled = false;
                                notifications.push("error", err.message);
                              });
                            return false;
                          }}
                        >
                          Log out
                        </button>
                      </div>
                    ) : (
                      <div class="px-2">
                        <a
                          class="text-base font-medium text-cyan-700 hover:text-cyan-900"
                          href=""
                        >
                          Log in
                        </a>
                      </div>
                    )}
                  </div>
                  <div class="text-sm font-mono text-stone-400 text-right p-2">
                    v{VERSION}
                  </div>
                </div>
              </TransitionChild>
              <div class="flex-shrink-0 w-14">
                {/* Force sidebar to shrink to fit close icon */}
              </div>
            </Dialog>
          </TransitionRoot>

          {/* Static sidebar for desktop */}
          <div class="hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0">
            <div class="flex-1 flex flex-col min-h-0 border-r border-stone-200 bg-white">
              <div class="flex-1 flex flex-col pt-5 pb-4 overflow-y-auto">
                <div class="flex items-center flex-shrink-0 px-4">
                  <img class="h-10 w-auto" src={LOGO_SVG} alt="GenieACS" />
                </div>
                <nav class="mt-5 flex-1 px-2 bg-white flex flex-col gap-1">
                  {navigation.map((item) => (
                    <a
                      key={item.name}
                      href={item.href}
                      class={classNames(
                        item.active
                          ? "bg-stone-100 text-stone-900"
                          : "text-stone-600 hover:bg-stone-50 hover:text-stone-900",
                        "group flex items-center px-2 py-2 text-sm font-medium rounded-md",
                      )}
                    >
                      {item.name}
                    </a>
                  ))}
                </nav>
              </div>
              <div class="p-2">
                {window.username ? (
                  <div class="flex items-center px-2 text-stone-600 text-sm">
                    {window.username}
                    <button
                      class="ml-auto text-sm font-medium text-cyan-700 hover:text-cyan-900"
                      onclick={(e) => {
                        e.target.disabled = true;
                        store
                          .logOut()
                          .then(() => {
                            location.hash = "";
                            location.reload();
                          })
                          .catch((err) => {
                            e.target.disabled = false;
                            notifications.push("error", err.message);
                          });
                        return false;
                      }}
                    >
                      Log out
                    </button>
                  </div>
                ) : (
                  <div class="px-2">
                    <a
                      class="text-sm font-medium text-cyan-700 hover:text-cyan-900"
                      href=""
                    >
                      Log in
                    </a>
                  </div>
                )}
              </div>
              <div class="text-xs font-mono text-stone-400 text-right p-2">
                v{VERSION}
              </div>
            </div>
          </div>
          <div class="md:pl-64 flex flex-col flex-1">
            <div class="sticky top-0 z-10 md:hidden pl-1 pt-1 sm:pl-3 sm:pt-3 bg-stone-100">
              <button
                type="button"
                class="-ml-0.5 -mt-0.5 h-12 w-12 inline-flex items-center justify-center rounded-md text-stone-500 hover:text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-cyan-500"
                onclick={(e) => {
                  setSidebarOpen(true);
                  e.redraw = false;
                  return false;
                }}
              >
                <span class="sr-only">Open sidebar</span>
                <Icon name="menu" class="h-6 w-6" />
              </button>
            </div>
            <main class="flex-1">
              <div class="py-6">
                <div class="px-4 sm:px-6 md:px-8">
                  {m(drawerComponent)}
                  {vnode.children}
                </div>
              </div>
            </main>
          </div>
        </div>,
        overlay.render(),
        m(datalist),
      ];
    },
  };
};

export default component;
