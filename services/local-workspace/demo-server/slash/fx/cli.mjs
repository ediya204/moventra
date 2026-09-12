import { openStore } from "../store.mjs";
import { importFX, cleanFX, fxCounts } from "./demo.mjs";
const args = process.argv.slice(2),
  command = args.shift() || "import";
const arg = (k, d) =>
  args.includes(k) ? Number(args[args.indexOf(k) + 1]) : d;
const db = openStore();
try {
  if (command === "import")
    console.log(
      JSON.stringify(
        importFX(db, {
          replicas: arg("--replicas", 1),
          batchSize: arg("--batch-size", 10),
        }),
        null,
        2,
      ),
    );
  else if (command === "clean") {
    cleanFX(db);
    console.log("Cleaned only fx-cross-currency-v1");
  } else if (command === "status")
    console.log(JSON.stringify(fxCounts(db), null, 2));
  else throw new Error("import | clean | status");
} finally {
  db.close();
}
