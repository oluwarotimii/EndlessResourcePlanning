import { createMockServer } from "./server";
const port = Number(process.env.MOCK_PORT ?? 4010);
createMockServer({ latencyMs: Number(process.env.MOCK_LATENCY ?? 150) }).listen(port, () =>
  console.log(`mock-server: http://localhost:${port}  (PINs: Cashier 1111, Manager 2222, Warehouse 3333, Stock 4444, Rider 5555, Coordinator 6666)`),
);
