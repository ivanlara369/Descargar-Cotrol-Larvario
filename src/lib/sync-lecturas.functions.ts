import { createServerFn } from "@tanstack/react-start";

export const syncLecturasToSheet = createServerFn({ method: "POST" })
  .inputValidator(
    (input: { files: { name: string; content: string }[] }) => input,
  )
  .handler(async ({ data }) => {
    const { syncLecturas } = await import("./sync-lecturas-core.server");
    return syncLecturas(data.files);
  });
