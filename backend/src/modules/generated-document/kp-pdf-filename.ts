/** Canonical Content-Disposition filename for quotation PDF (TZ-SALES-369). */
export function buildKpPdfFilename(
  number: string | undefined | null,
  quotationId: string,
): string {
  const trimmed = (number ?? '').trim();
  if (trimmed) {
    return `КП-${trimmed}.pdf`;
  }
  return `КП-черновик-${quotationId.slice(0, 8)}.pdf`;
}

export function buildKpPdfContentDisposition(
  number: string | undefined | null,
  quotationId: string,
): string {
  const utf8Name = buildKpPdfFilename(number, quotationId);
  const asciiFallback = utf8Name
    .replace(/^КП-/, 'KP-')
    .replace(/черновик/g, 'chernovik');
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`;
}
