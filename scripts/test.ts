
import { createClient } from "@libsql/client";

const db = createClient({
  url: "libsql://becoartes-menu-pdv-guimameluco.turso.io",
  authToken: "...", // I don't have the token here easily, but I can get it from .env
});
