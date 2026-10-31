import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** Screens built so far, by registry ID. Everything else renders the placeholder. Each is its own lazy chunk. */
export const BUILT: Record<string, LazyExoticComponent<ComponentType>> = {
  S01: lazy(() => import("./TillPage").then((m) => ({ default: m.TillPage }))),
  S02: lazy(() => import("./ParkedPage").then((m) => ({ default: m.ParkedPage }))),
  S03: lazy(() => import("./ShiftPage").then((m) => ({ default: m.ShiftPage }))),
  S04: lazy(() => import("./CustomerLookupPage").then((m) => ({ default: m.CustomerLookupPage }))),
  S06: lazy(() => import("./BuildOrderPage").then((m) => ({ default: m.BuildOrderPage }))),
  P03: lazy(() => import("./SyncTrayPage").then((m) => ({ default: m.SyncTrayPage }))),
  P06: lazy(() => import("./PrintTemplatesPage").then((m) => ({ default: m.PrintTemplatesPage }))),
  Q01: lazy(() => import("./CashUpPage").then((m) => ({ default: m.CashUpPage }))),
  Q02: lazy(() => import("./CashUpSignOffPage").then((m) => ({ default: m.CashUpSignOffPage }))),
  T03: lazy(() => import("./ReturnInspectionPage").then((m) => ({ default: m.ReturnInspectionPage }))),
  T04: lazy(() => import("./FixMixupPage").then((m) => ({ default: m.FixMixupPage }))),
  G11: lazy(() => import("./MixupReportPage").then((m) => ({ default: m.MixupReportPage }))),
  T01: lazy(() => import("./ReturnsPage").then((m) => ({ default: m.ReturnsPage }))),
  R01: lazy(() => import("./PurchaseOrdersPage").then((m) => ({ default: m.PurchaseOrdersPage }))),
  H01: lazy(() => import("./GoodsReceiptPage").then((m) => ({ default: m.GoodsReceiptPage }))),
  H02: lazy(() => import("./StockRequestPage").then((m) => ({ default: m.StockRequestPage }))),
  H03: lazy(() => import("./DispatchPage").then((m) => ({ default: m.DispatchPage }))),
  H04: lazy(() => import("./ReceiveTransferPage").then((m) => ({ default: m.ReceiveTransferPage }))),
  H05: lazy(() => import("./StockLookupPage").then((m) => ({ default: m.StockLookupPage }))),
  G02: lazy(() => import("./InTransitReportPage").then((m) => ({ default: m.InTransitReportPage }))),
  K01: lazy(() => import("./CountPage").then((m) => ({ default: m.CountPage }))),
  K02: lazy(() => import("./CountDifferencesPage").then((m) => ({ default: m.CountDifferencesPage }))),
  L01: lazy(() => import("./DispatchBoardPage").then((m) => ({ default: m.DispatchBoardPage }))),
  L02: lazy(() => import("./RiderDeliveriesPage").then((m) => ({ default: m.RiderDeliveriesPage }))),
  L03: lazy(() => import("./ProofOfDeliveryPage").then((m) => ({ default: m.ProofOfDeliveryPage }))),
  L04: lazy(() => import("./RiderCashPage").then((m) => ({ default: m.RiderCashPage }))),
  L05: lazy(() => import("./CodOutstandingPage").then((m) => ({ default: m.CodOutstandingPage }))),
  A02: lazy(() => import("./ManagerHomePage").then((m) => ({ default: m.ManagerHomePage }))),
  G01: lazy(() => import("./CashUpVarianceReportPage").then((m) => ({ default: m.CashUpVarianceReportPage }))),
  A01: lazy(() => import("./ApprovalsPage").then((m) => ({ default: m.ApprovalsPage }))),
};

/** Screens built as a dialog inside another screen, so they have no route of their own. */
export const BUILT_DIALOGS: Record<string, true> = {
  S05: true,
  CR01: true,
};
