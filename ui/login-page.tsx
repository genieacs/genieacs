import { ClosureComponent, Component, Children } from "mithril";
import { m } from "./components.ts";
import * as store from "./store.ts";
import * as notifications from "./notifications.ts";
import * as overlay from "./overlay.ts";
import changePasswordComponent from "./change-password-component.ts";

export function init(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return Promise.resolve(args);
}

export const component: ClosureComponent = (): Component => {
  let username = "";
  let password = "";
  let remember = false;

  function logIn(e: MouseEvent): boolean {
    e.target["disabled"] = true;
    store
      .logIn(username, password, remember)
      .then(() => {
        location.reload();
      })
      .catch((err) => {
        notifications.push("error", err.response || err.message);
        e.target["disabled"] = false;
      });
    return false;
  }

  function changePassword(): void {
    const cb = (): Children => {
      const attrs = {
        onPasswordChange: () => {
          overlay.close(cb);
          m.redraw();
        },
      };
      return m(changePasswordComponent, attrs);
    };
    overlay.open(cb);
  }

  return {
    view: (vnode) => {
      if (window.username) m.route.set(vnode.attrs["continue"] || "/");

      document.title = "Login - GenieACS";

      return (
        <div class="min-h-full flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
          <div class="max-w-md w-full flex flex-col gap-8">
            <div>
              <svg
                class="mx-auto h-14 w-auto"
                xmlns:xlink="http://www.w3.org/1999/xlink"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 64 64"
              >
                <defs>
                  <linearGradient id="a">
                    <stop offset="0" stop-color="#b72f5f" />
                    <stop offset="1" stop-color="#872346" />
                  </linearGradient>
                  <linearGradient
                    xlink:href="#a"
                    id="b"
                    gradientUnits="userSpaceOnUse"
                    gradientTransform="matrix(.28375 0 0 -.28375 27.92 37.384)"
                    x1="16.045"
                    y1="132.803"
                    x2="16.045"
                    y2="-81.164"
                  />
                </defs>
                <path
                  d="m27.92 37.38 2.6 4.94c-1.15 2.01-2.71 3.74-4.68 5.21-3.22 1.9-5.83 1.59-7.85-.92 3.9-1.76 7.21-4.83 9.93-9.22M18.74 27.2c-.27 2.86-.93 5.67-1.96 8.36-.79 2.08-1.33 4.25-1.6 6.45-.19 1.55.03 3.12.64 4.55.62 1.49 1.73 2.76 3.33 3.82-1.73.52-3.24.66-4.54.43-2.27-.44-3.75-1.81-4.44-4.1a13.48 13.48 0 0 1-.35-6.76c.4-2.11.95-4.18 1.64-6.21a43.64 43.64 0 0 0 1.63-6.46c.14-.83.16-1.7.04-2.6-.14-.96-.49-1.87-1.04-2.67a5.838 5.838 0 0 0-2.27-1.91c.93-.17 1.84-.31 2.75-.43.94-.08 1.89.08 2.75.47 1.12.49 1.95 1.3 2.51 2.41.75 1.42 1.06 3.04.89 4.64zm29.81-10.63-6.98 6.34 2.1 2.1 6.34-6.98.82.84-6.97 6.34 1.97 1.97 6.34-6.97.84.82-6.98 6.34 2.1 2.1 6.67-6.67 1.42 1.39-5.98 5.99-7.8 7.79-4.74 1.94-6.8-5.08 4.49 6.03-1.5.61-6.61-6.61 1.68-4.09 6.18 4.64.01.01.04-.03-.01-.02-5.25-6.99.85-2.09 6.39-6.38 7.38-7.38 1.41 1.39-6.68 6.68 2.09 2.09 6.34-6.97zm4.67 36.63C59.07 47.35 62 40.28 62 31.99c0-8.26-2.93-15.33-8.78-21.21C47.34 4.93 40.27 2 32.01 2c-8.29 0-15.36 2.93-21.21 8.78-3.6 3.61-6.08 7.65-7.47 12.15l.6-.33c2.98-1.57 5.62-.77 7.92 2.41-2.08.43-3.75.87-5.01 1.35-.69.27-1.33.63-1.9 1.09-1.28 1.01-2.08 2.3-2.41 3.86-.48 2.19-.47 4.47.04 6.65 1.08 5.77 3.82 10.85 8.23 15.24 5.85 5.87 12.92 8.8 21.21 8.8 8.28 0 15.35-2.93 21.21-8.8"
                  fill="url(#b)"
                />
              </svg>
              <h2 class="mt-6 text-center text-3xl font-extrabold text-stone-900">
                Log in to continue
              </h2>
            </div>
            <form class="mt-8 flex flex-col gap-6">
              <div class="rounded-md shadow-xs -space-y-px">
                <div>
                  <label for="username" class="sr-only">
                    Username
                  </label>
                  <input
                    id="username"
                    name="username"
                    type="text"
                    value={username}
                    autocomplete="username"
                    required
                    class="appearance-none rounded-none relative block w-full px-3 py-2 border border-stone-300 placeholder-stone-500 text-stone-900 rounded-t-md focus:outline-hidden focus:ring-cyan-500 focus:border-cyan-500 focus:z-10 sm:text-sm"
                    placeholder="Username"
                    oninput={(e) => {
                      username = e.target.value;
                    }}
                  />
                </div>
                <div>
                  <label for="password" class="sr-only">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    value={password}
                    autocomplete="current-password"
                    required
                    class="appearance-none rounded-none relative block w-full px-3 py-2 border border-stone-300 placeholder-stone-500 text-stone-900 rounded-b-md focus:outline-hidden focus:ring-cyan-500 focus:border-cyan-500 focus:z-10 sm:text-sm"
                    placeholder="Password"
                    oninput={(e) => {
                      password = e.target.value;
                    }}
                  />
                </div>
              </div>

              <div class="flex items-center justify-between">
                <div class="flex items-center">
                  <input
                    id="remember"
                    name="remember"
                    type="checkbox"
                    value={remember}
                    class="h-4 w-4 text-cyan-700 focus:ring-cyan-500 border-stone-300 rounded-sm"
                    onchange={(e) => {
                      remember = e.target.checked;
                    }}
                  />
                  <label
                    for="remember"
                    class="ml-2 block text-sm text-stone-900"
                  >
                    Remember me
                  </label>
                </div>

                <div class="text-sm">
                  <button
                    type="button"
                    class="font-medium text-cyan-700 hover:text-cyan-900"
                    onclick={changePassword}
                  >
                    Change password
                  </button>
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  class="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500"
                  onclick={logIn}
                >
                  <span class="absolute left-0 inset-y-0 flex items-center pl-3">
                    <svg
                      class="h-5 w-5 text-cyan-500 group-hover:text-cyan-400"
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      aria-hidden="true"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </span>
                  Log in
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    },
  };
};
