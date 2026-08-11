import { createServerFn } from "@tanstack/react-start";

export const syncEntomologiaToSheet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { files: { name: string; content: string }[] }) => input,
  )
  .handler(async ({ data }) => {
    const { syncEntomologia } = await import("./sync-entomologia-core.server");
    return syncEntomologia(data.files);
  });
