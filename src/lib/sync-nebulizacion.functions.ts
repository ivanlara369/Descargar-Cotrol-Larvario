import { createServerFn } from "@tanstack/react-start";

export const syncNebulizacionToSheet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { files: { name: string; content: string }[] }) => input,
  )
  .handler(async ({ data }) => {
    const { syncNebulizacion } = await import("./sync-nebulizacion-core.server");
    return syncNebulizacion(data.files);
  });
