import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { syncLecturasToSheet } from "@/lib/sync-lecturas.functions";

export const Route = createFileRoute("/lecturas")({
  head: () => ({
    meta: [
      { title: "Sincronizador Lectura de Ovitrampas" },
      {
        name: "description",
        content: "Sube archivos CSV o TXT de Lectura de Ovitrampas y sincroniza a Google Sheets.",
      },
    ],
  }),
  component: LecturasPage,
});

type Result = Awaited<ReturnType<typeof syncLecturasToSheet>>;

function LecturasPage() {
  const sync = useServerFn(syncLecturasToSheet);
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!files.length) return;
    setLoading(true);
    try {
      const payload = await Promise.all(
        files.map(async (f) => {
          const isTxt = /\.txt$/i.test(f.name);
          const buf = await f.arrayBuffer();
          let content: string;
          if (isTxt) {
            // TXT viene en UTF-16 LE con BOM
            const bytes = new Uint8Array(buf);
            const hasBom = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
            const decoder = new TextDecoder("utf-16le");
            content = decoder.decode(hasBom ? bytes.subarray(2) : bytes);
          } else {
            // CSV: intenta UTF-8; si aparece el carácter de reemplazo, cae a ISO-8859-15 (Latin-9)
            const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(buf);
            content = utf8.includes("\uFFFD")
              ? new TextDecoder("iso-8859-15").decode(buf)
              : utf8;
          }
          return { name: f.name, content };
        }),
      );
      const res = await sync({ data: { files: payload } });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Volver al inicio
        </Link>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-foreground">
          Sincronizador Lectura de Ovitrampas
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sube uno o varios archivos <strong>.csv</strong> (se descartan las
          primeras 3 filas de metadatos) o <strong>.txt</strong> (UTF-16, tabulado,
          con encabezado en la primera fila). Los datos únicos se agregarán a la
          hoja de Google configurada.
        </p>

        <form
          onSubmit={onSubmit}
          className="mt-8 rounded-lg border border-border bg-card p-6 shadow-sm"
        >
          <label className="block text-sm font-medium text-foreground">
            Archivos
          </label>
          <input
            type="file"
            multiple
            accept=".csv,.txt,text/csv,text/plain"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            className="mt-2 block w-full text-sm text-foreground file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
          />
          {files.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              {files.map((f) => (
                <li key={f.name}>
                  • {f.name} ({(f.size / 1024).toFixed(1)} KB)
                </li>
              ))}
            </ul>
          )}

          <button
            type="submit"
            disabled={loading || !files.length}
            className="mt-6 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Sincronizando..." : "Sincronizar a Google Sheets"}
          </button>
        </form>

        {error && (
          <div className="mt-6 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {result && (
          <div className="mt-6 rounded-md border border-border bg-card p-6 text-sm">
            <h2 className="font-semibold text-foreground">Resultado</h2>
            <ul className="mt-3 space-y-1 text-muted-foreground">
              <li>Filas recibidas: {result.totalIncoming}</li>
              <li>Ya existían en la hoja: {result.existingBefore}</li>
              <li className="text-foreground">
                <strong>Insertadas (únicas): {result.inserted}</strong>
              </li>
              <li>Duplicados ignorados: {result.duplicates}</li>
            </ul>
            <a
              href={result.sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              Abrir Google Sheet
            </a>
          </div>
        )}
      </div>
    </div>
  );
}