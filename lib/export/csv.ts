/**
 * CSV seguro: aspas escapadas e proteção contra "CSV/formula injection"
 * (células iniciadas por = + - @ são prefixadas com apóstrofo).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",") + "\r\n";
}

/** BOM para o Excel reconhecer UTF-8 (acentos). */
export const CSV_BOM = "﻿";
