import { createServerFn } from "@tanstack/react-start";

export const syncIntraToSheet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { files: { name: string; content: string }[] }) => input,
  )
  .handler(async ({ data }) => {
    const { syncIntra } = await import("./sync-intra-core.server");
    return syncIntra(data.files);
  });
