import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** Screens built so far, by registry ID. Everything else renders the placeholder. Each is its own lazy chunk. */
export const BUILT: Record<string, LazyExoticComponent<ComponentType>> = {
  S01: lazy(() => import("./TillPage").then((m) => ({ default: m.TillPage }))),
  S02: lazy(() => import("./ParkedPage").then((m) => ({ default: m.ParkedPage }))),
  S03: lazy(() => import("./ShiftPage").then((m) => ({ default: m.ShiftPage }))),
  S04: lazy(() => import("./CustomerLookupPage").then((m) => ({ default: m.CustomerLookupPage }))),
  P03: lazy(() => import("./SyncTrayPage").then((m) => ({ default: m.SyncTrayPage }))),
  P06: lazy(() => import("./PrintTemplatesPage").then((m) => ({ default: m.PrintTemplatesPage }))),
  A01: lazy(() => import("./ApprovalsPage").then((m) => ({ default: m.ApprovalsPage }))),
};
