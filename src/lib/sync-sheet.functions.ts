import { createServerFn } from "@tanstack/react-start";

export const syncFilesToSheet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { files: { name: string; content: string }[] }) => input,
  )
  .handler(async ({ data }) => {
    const { syncFiles } = await import("./sync-sheet-core.server");
    return syncFiles(data.files);
  });
