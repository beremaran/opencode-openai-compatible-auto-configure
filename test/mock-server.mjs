import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 18999);

const server = createServer((req, res) => {
  if (req.url === "/v1/models") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        object: "list",
        data: [
          { id: "e2e-ultra", context_length: 131072, max_output_tokens: 8192 },
          { id: "e2e-mini" },
        ],
      }),
    );
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("READY");
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
