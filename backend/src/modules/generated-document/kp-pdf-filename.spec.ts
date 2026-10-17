import {
  buildKpPdfContentDisposition,
  buildKpPdfFilename,
} from './kp-pdf-filename';

describe('kp-pdf-filename (TZ-SALES-369)', () => {
  it('buildKpPdfFilename uses number when present', () => {
    expect(buildKpPdfFilename('QTN-9', '507f1f77bcf86cd799439011')).toBe('КП-QTN-9.pdf');
  });

  it('buildKpPdfFilename uses черновik short id without number', () => {
    expect(buildKpPdfFilename('', '507f1f77bcf86cd799439011')).toBe(
      'КП-черновик-507f1f77.pdf',
    );
  });

  it('buildKpPdfContentDisposition sets RFC5987 filename*', () => {
    const header = buildKpPdfContentDisposition('QTN-1', '507f1f77bcf86cd799439011');
    expect(header).toContain('filename="KP-QTN-1.pdf"');
    expect(header).toContain(
      `filename*=UTF-8''${encodeURIComponent('КП-QTN-1.pdf')}`,
    );
  });

  it('buildKpPdfContentDisposition ascii fallback for draft', () => {
    const header = buildKpPdfContentDisposition('', '507f1f77bcf86cd799439011');
    expect(header).toContain('filename="KP-chernovik-507f1f77.pdf"');
    expect(header).toContain(
      `filename*=UTF-8''${encodeURIComponent('КП-черновик-507f1f77.pdf')}`,
    );
  });
});
