import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { syncFilesToSheet } from "@/lib/sync-sheet.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Descargas Cotrol Laravrio" },
      {
        name: "description",
        content:
          "Datos.",
      },
    ],
  }),
  component: Index,
});

type Result = Awaited<ReturnType<typeof syncFilesToSheet>>;

function Index() {
  const sync = useServerFn(syncFilesToSheet);
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
          const isTxt = /\.txt$/i.test(f.name) || f.type === "text/plain";
          const buf = await f.arrayBuffer();
          const decoder = new TextDecoder(isTxt ? "iso-8859-15" : "utf-8");
          return { name: f.name, content: decoder.decode(buf) };
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
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          Sincronizador Control Larvario
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Sube uno o varios archivos <strong>.csv</strong> o <strong>.txt</strong>{" "}
          (mismo formato, primeras 3 filas se descartan). Los datos únicos se
          agregarán a una hoja en tu carpeta de Google Drive.
        </p>

        <div className="mt-4 rounded-md border border-border bg-card p-3 text-sm">
          <span className="text-muted-foreground">¿Vas a subir lecturas de ovitrampas? </span>
          <Link to="/lecturas" className="font-medium text-primary hover:underline">
            Ir al Sincronizador de Lectura de Ovitrampas →
          </Link>
        </div>

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
