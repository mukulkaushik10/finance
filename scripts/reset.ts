import { resetDatabase } from "../src/server/seed/demo";
import { rawPrisma } from "../src/server/db/client";

// Empties every Control Room table in the database named by DATABASE_URL (dev only).
resetDatabase().then(() => console.log("All tables emptied.")).finally(() => rawPrisma.$disconnect());
