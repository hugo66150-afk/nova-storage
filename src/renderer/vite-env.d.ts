/// <reference types="vite/client" />

import type { NovaApi } from "../shared/types";

declare global {
  interface Window {
    nova: NovaApi;
  }
}

export {};