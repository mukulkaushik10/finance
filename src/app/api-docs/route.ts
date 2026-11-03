// API reference (Swagger UI) rendered from /api/openapi.json.
export function GET() {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Control Room API</title><link rel="stylesheet" href="/api-docs/assets/swagger-ui.css">
<style>body{margin:0;background:#fff} .topbar{display:none}</style></head>
<body><div id="ui"></div><script src="/api-docs/assets/swagger-ui-bundle.js"></script>
<script>window.ui = SwaggerUIBundle({ url: "/api/openapi.json", dom_id: "#ui", deepLinking: true, defaultModelsExpandDepth: 0 });</script>
</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
