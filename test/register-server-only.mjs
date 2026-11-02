// tsx loads TypeScript tests through CommonJS require, which does not
// honor the server-only package "react-server" export. Point that
// specifier at an empty shim so server modules can be imported in tests.
import Module from "node:module";
import { fileURLToPath } from "node:url";

const shim = fileURLToPath(new URL("./shims/server-only.cjs", import.meta.url));
const original = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request === "server-only") return shim;
  return original.call(this, request, parent, isMain, options);
};
