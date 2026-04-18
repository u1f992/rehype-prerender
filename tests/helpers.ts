import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BROWSER_CACHE_DIR = path.resolve(__dirname, ".cache");

export const FIXTURES_DIR = path.join(__dirname, "fixtures");

export const RESULTS_DIR = path.join(__dirname, "results");
