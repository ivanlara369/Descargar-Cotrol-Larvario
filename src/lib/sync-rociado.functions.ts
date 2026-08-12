import { createServerFn } from "@tanstack/react-start";

export const syncRociadoToSheet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { files: { name: string; content: string }[] }) => input,
  )
  .handler(async ({ data }) => {
    const { syncRociado } = await import("./sync-rociado-core.server");
    return syncRociado(data.files);
  });
