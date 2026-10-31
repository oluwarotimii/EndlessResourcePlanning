import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// The jsdom flows (till, approvals) can take longer than the 1s default when the whole suite runs in parallel.
configure({ asyncUtilTimeout: 3000 });
