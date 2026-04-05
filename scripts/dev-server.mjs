import path from "node:path";
import { startStaticServer } from "./server-utils.mjs";

const rootDir = path.resolve(process.cwd(), process.env.ROOT_DIR ?? "mirror");
const port = Number(process.env.PORT ?? "4173");
await startStaticServer({ rootDir, host: "127.0.0.1", port, quiet: false });
