#!/usr/bin/env node
import { HostController } from "./host-controller.js";
import { PiSdkRuntimeFactory } from "./pi/pi-sdk-runtime.js";
import { MobileHostServer } from "./server/mobile-host-server.js";

const port = Number(process.env.PI_MOBILE_HOST_PORT ?? "4739");
const hostname = process.env.PI_MOBILE_HOST_BIND ?? "127.0.0.1";
const token = process.env.PI_MOBILE_HOST_TOKEN;

const controller = new HostController(new PiSdkRuntimeFactory());
const server = new MobileHostServer(controller, token ? { token } : {});

await server.listen(port, hostname);
console.log(`pi-mobile host listening at http://${hostname}:${port}`);
if (token) {
  console.log("PI_MOBILE_HOST_TOKEN is enabled; mobile clients must send it as a bearer token.");
}

const shutdown = async () => {
  await server.close();
  await controller.dispose();
};

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});
