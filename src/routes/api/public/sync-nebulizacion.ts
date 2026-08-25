import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export const Route = createFileRoute("/api/public/sync-nebulizacion")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            files?: { name?: string; content?: string }[];
          };
          const files = (body.files || [])
            .filter((f) => typeof f?.content === "string")
            .map((f) => ({ name: String(f.name || "archivo.csv"), content: f.content as string }));
          if (!files.length) return json({ error: "No se recibieron archivos" }, 400);
          if (files.length > 20) return json({ error: "Máximo 20 archivos por carga" }, 400);
          const total = files.reduce((n, f) => n + f.content.length, 0);
          if (total > 15_000_000) return json({ error: "Carga demasiado grande" }, 413);

          const { syncNebulizacion } = await import("@/lib/sync-nebulizacion-core.server");
          return json(await syncNebulizacion(files));
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Error desconocido";
          console.error("sync-nebulizacion failed:", msg);
          return json({ error: msg }, 500);
        }
      },
    },
  },
});
