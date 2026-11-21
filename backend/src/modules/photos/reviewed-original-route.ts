import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { PhotoIntakeService } from './photo-intake.service';

/** Ссылка открывается по правилам оригиналов C169 после фиксации счёта и Photo одной транзакцией. */
export function registerReviewedOriginalRoute(app: INestApplication) {
  const reviewedPhotos = app.get(PhotoIntakeService);
  app.getHttpAdapter().getInstance().get('/uploads/reviewed-invoices/:file', (req: Request, res: Response, next: NextFunction) => {
    const id = /^([a-f0-9]{24})\.pdf$/.exec(String(req.params.file))?.[1];
    if (!id) return res.sendStatus(404);
    void reviewedPhotos.reviewedPath(id).then(file => {
      if (!file) { res.sendStatus(404); return; }
      res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="document.pdf"' });
      res.sendFile(file, { dotfiles: 'allow' }, err => { if (err) next(err); });
    }).catch(next);
  });
}
