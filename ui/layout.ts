// Layout component - DOM-based approach
// Renders the app shell with a content slot for page content

import { createIcon } from "./icons.ts";
import { logOut } from "./api-client.ts";
import * as notifications from "./notifications.ts";
import { version as VERSION } from "../package.json";
import { LOGO_SVG } from "../build/assets.ts";
import { SignalBase } from "./signals.ts";
import { div, nav, button, a, span, img, main } from "./dom.ts";

interface NavItem {
  name: string;
  href: string;
}

function getNavigation(): NavItem[] {
  return [
    {
      name: "Overview",
      href: "/overview",
      enabled: window.authorizer.hasAccess("devices", 1),
    },
    {
      name: "Devices",
      href: "/devices",
      enabled: window.authorizer.hasAccess("devices", 2),
    },
    {
      name: "Faults",
      href: "/faults",
      enabled: window.authorizer.hasAccess("faults", 2),
    },
    {
      name: "Presets",
      href: "/presets",
      enabled: window.authorizer.hasAccess("presets", 2),
    },
    {
      name: "Provisions",
      href: "/provisions",
      enabled: window.authorizer.hasAccess("provisions", 2),
    },
    {
      name: "Virtual Parameters",
      href: "/virtualParameters",
      enabled: window.authorizer.hasAccess("virtualParameters", 2),
    },
    {
      name: "Files",
      href: "/files",
      enabled: window.authorizer.hasAccess("files", 2),
    },
    {
      name: "Config",
      href: "/config",
      enabled: window.authorizer.hasAccess("config", 2),
    },
    {
      name: "Permissions",
      href: "/permissions",
      enabled: window.authorizer.hasAccess("permissions", 2),
    },
    {
      name: "Users",
      href: "/users",
      enabled: window.authorizer.hasAccess("users", 2),
    },
    {
      name: "Views",
      href: "/views",
      enabled: window.authorizer.hasAccess("views", 2),
    },
  ]
    .filter((item) => item.enabled)
    .map(({ name, href }) => ({ name, href }));
}

function classNames(...classes: string[]): string {
  return classes.filter(Boolean).join(" ");
}

export function createLayout(
  routeSignal: SignalBase<string>,
  pageSignal: SignalBase<HTMLElement | null>,
): HTMLElement {
  const navigation = getNavigation();

  // DOM references for transition targets
  let overlayEl: HTMLElement | null = null;
  let sidebarEl: HTMLElement | null = null;
  let closeButtonEl: HTMLElement | null = null;
  let dialogEl: HTMLElement | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function openSidebar(): void {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (!dialogEl || !overlayEl || !sidebarEl || !closeButtonEl) return;
    dialogEl.style.display = "flex";
    // Force reflow so the browser registers the "from" state (opacity-0,
    // -translate-x-full) before we toggle to the "to" state — otherwise
    // no transition plays when going from display:none to display:flex.
    void dialogEl.offsetHeight;
    overlayEl.classList.replace("opacity-0", "opacity-100");
    sidebarEl.classList.replace("-translate-x-full", "translate-x-0");
    closeButtonEl.classList.replace("opacity-0", "opacity-100");
  }

  function closeSidebar(): void {
    if (!dialogEl || !overlayEl || !sidebarEl || !closeButtonEl) return;
    if (closeTimer) clearTimeout(closeTimer);
    overlayEl.classList.replace("opacity-100", "opacity-0");
    sidebarEl.classList.replace("translate-x-0", "-translate-x-full");
    closeButtonEl.classList.replace("opacity-100", "opacity-0");
    closeTimer = setTimeout(() => {
      if (dialogEl) dialogEl.style.display = "none";
      closeTimer = null;
    }, 300);
  }

  function handleLogout(e: Event): void {
    const btn = e.currentTarget as HTMLButtonElement;
    btn.disabled = true;
    logOut()
      .then(() => location.reload())
      .catch((err) => {
        btn.disabled = false;
        notifications.push("error", err.message);
      });
  }

  // Create navigation links
  function createNavLinks(textSize: string): HTMLElement[] {
    return navigation.map((item) =>
      a(
        {
          href: item.href,
          class: () =>
            classNames(
              `${routeSignal.get()}/`.startsWith(`${item.href}/`)
                ? "bg-stone-100 text-stone-900"
                : "text-stone-600 hover:bg-stone-50 hover:text-stone-900",
              `group flex items-center px-2 py-2 font-medium rounded-md ${textSize}`,
            ),
        },
        item.name,
      ),
    );
  }

  // Create user section
  function createUserSection(textSize: string): HTMLElement {
    if (window.username) {
      return div(
        { class: `flex items-center px-2 text-stone-600 ${textSize}` },
        window.username,
        button(
          {
            class: `ml-auto ${textSize} font-medium text-cyan-700 hover:text-cyan-900`,
            onclick: handleLogout,
          },
          "Log out",
        ),
      );
    } else {
      return div(
        { class: "px-2" },
        a(
          {
            href: "/login",
            class: `${textSize} font-medium text-cyan-700 hover:text-cyan-900`,
          },
          "Log in",
        ),
      );
    }
  }

  // Mobile sidebar dialog
  dialogEl = div(
    {
      class: "mobile-dialog fixed inset-0 flex z-40 md:hidden",
      role: "dialog",
      "aria-modal": "true",
      style: "display: none",
    },
    // Overlay
    (overlayEl = div({
      class:
        "mobile-overlay fixed inset-0 bg-black/50 transition-opacity ease-linear duration-300 opacity-0",
      "aria-hidden": "true",
      onclick: closeSidebar,
    })),
    // Sidebar panel
    (sidebarEl = div(
      {
        class:
          "mobile-sidebar relative flex-1 flex flex-col max-w-xs w-full bg-white transition ease-in-out duration-300 transform -translate-x-full",
      },
      // Close button
      (closeButtonEl = div(
        {
          class:
            "mobile-close-btn absolute top-0 right-0 -mr-12 pt-2 ease-in-out duration-300 opacity-0",
        },
        button(
          {
            type: "button",
            class:
              "ml-1 flex items-center justify-center h-10 w-10 rounded-full focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-white",
            onclick: closeSidebar,
          },
          span({ class: "sr-only" }, "Close sidebar"),
          createIcon({ name: "close", class: "h-6 w-6 text-white" }),
        ),
      )),
      // Sidebar content
      div(
        { class: "flex-1 h-0 pt-5 pb-4 overflow-y-auto" },
        div(
          { class: "flex-shrink-0 flex items-center px-4" },
          img({ class: "h-10 w-auto", src: `/${LOGO_SVG}`, alt: "GenieACS" }),
        ),
        nav(
          { class: "mt-5 px-2 flex flex-col gap-1" },
          ...createNavLinks("text-base"),
        ),
      ),
      div({ class: "p-2" }, createUserSection("text-base")),
      div(
        { class: "text-sm font-mono text-stone-400 text-right p-2" },
        `v${VERSION}`,
      ),
    )),
    // Spacer
    div({ class: "flex-shrink-0 w-14" }),
  );

  // Desktop sidebar
  const desktopSidebar = div(
    {
      class:
        "hidden md:flex md:w-64 md:flex-col md:fixed md:inset-y-0 md:left-0 z-20",
    },
    div(
      {
        class:
          "flex-1 flex flex-col min-h-0 border-r border-stone-200 bg-white",
      },
      div(
        { class: "flex-1 flex flex-col pt-5 pb-4 overflow-y-auto" },
        div(
          { class: "flex items-center flex-shrink-0 px-4" },
          img({ class: "h-10 w-auto", src: `/${LOGO_SVG}`, alt: "GenieACS" }),
        ),
        nav(
          { class: "mt-5 flex-1 px-2 bg-white flex flex-col gap-1" },
          ...createNavLinks("text-sm"),
        ),
      ),
      div({ class: "p-2" }, createUserSection("text-sm")),
      div(
        { class: "text-xs font-mono text-stone-400 text-right p-2" },
        `v${VERSION}`,
      ),
    ),
  );

  // Mobile menu button
  const mobileMenuButton = div(
    {
      class:
        "sticky top-0 z-10 md:hidden pl-1 pt-1 sm:pl-3 sm:pt-3 bg-stone-100",
    },
    button(
      {
        type: "button",
        class:
          "-ml-0.5 -mt-0.5 h-12 w-12 inline-flex items-center justify-center rounded-md text-stone-500 hover:text-stone-900 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-cyan-500",
        onclick: openSidebar,
      },
      span({ class: "sr-only" }, "Open sidebar"),
      createIcon({ name: "menu", class: "h-6 w-6" }),
    ),
  );

  // Page content slot — reactive child auto-disposes old page on change
  const contentSlot = div({ class: "page-content" }, () => pageSignal.get());

  // Main content
  const mainContent = div(
    { class: "md:pl-64 flex flex-col flex-1" },
    mobileMenuButton,
    main(
      { class: "flex-1" },
      div(
        { class: "py-6" },
        div({ class: "px-4 sm:px-6 md:px-8" }, contentSlot),
      ),
    ),
  );

  return div({}, dialogEl, desktopSidebar, mainContent);
}
