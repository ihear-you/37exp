// Журнал событий загрузки на сервере. Строки уходят в вывод службы (на сервере: journalctl -u plenka),
// время в миллисекундах и размеры в МБ: по журналу видно, на каком шаге теряется время.

export const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} МБ`;
export const speed = (bytes: number, ms: number) => `${((bytes / 1048576) * (1000 / Math.max(ms, 1))).toFixed(2)} МБ/с`;
export const since = (start: number) => Date.now() - start;

export function log(scope: "upload" | "ingest" | "import", message: string) {
  console.info(`[${scope}] ${message}`);
}
