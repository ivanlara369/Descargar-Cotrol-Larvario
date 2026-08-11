import { createServerFn } from "@tanstack/react-start";

export const syncViviendaToSheet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { files: { name: string; content: string }[] }) => input,
  )
  .handler(async ({ data }) => {
    const { syncVivienda } = await import("./sync-vivienda-core.server");
    return syncVivienda(data.files);
  });
