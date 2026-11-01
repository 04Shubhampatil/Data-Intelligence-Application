import path from "node:path";
import { config } from "dotenv";

// Single .env at the repo root. Real environment variables win.
config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
