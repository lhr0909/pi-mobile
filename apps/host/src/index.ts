#!/usr/bin/env node
import { HostController } from "./host-controller.js";
import { PiSdkRuntimeFactory } from "./pi/pi-sdk-runtime.js";
import { MobileHostServer } from "./server/mobile-host-server.js";

const port = Number(process.env.PI_MOBILE_HOST_PORT ?? "4739");
const hostname = process.env.PI_MOBILE_HOST_BIND ?? "localhost";
const token = process.env.PI_MOBILE_HOST_TOKEN;
const corsOrigin = process.env.PI_MOBILE_HOST_CORS_ORIGIN;

const controller = new HostController(new PiSdkRuntimeFactory());
const server = new MobileHostServer(controller, {
  ...(token ? { token } : {}),
  ...(corsOrigin ? { corsOrigin } : {}),
});

await server.listen(port, hostname);
console.log(`pi-mobile host listening at http://${hostname}:${port}`);
if (token) {
  console.log(
    "PI_MOBILE_HOST_TOKEN is enabled; mobile clients must send it as a bearer token.",
  );
}
if (corsOrigin) {
  console.log(`PI_MOBILE_HOST_CORS_ORIGIN is enabled for ${corsOrigin}.`);
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
