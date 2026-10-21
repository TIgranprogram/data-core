import { PhotosController } from './photos.controller';

function buildController() {
  const service = {
    upload: jest.fn(),
    updateFrame: jest.fn(),
  };
  return { controller: new PhotosController(service as never), service };
}

describe('PhotosController upload', () => {
  it('keeps original fields and exposes the generated thumb variant', async () => {
    const { controller, service } = buildController();
    const original = {
      _id: 'original-id',
      storageUrl: '/uploads/original.png',
      variant: 'original',
      toObject: () => ({
        _id: 'original-id',
        storageUrl: '/uploads/original.png',
        variant: 'original',
      }),
    };
    const thumb = {
      _id: 'thumb-id',
      storageUrl: '/uploads/thumb.webp',
      variant: 'thumb' as const,
      widthPx: 320,
      heightPx: 200,
    };
    service.upload.mockResolvedValue({ original, thumb });

    const response = await controller.upload({
      filename: 'original.png',
      originalname: 'product.png',
      mimetype: 'image/png',
      size: 100,
    });

    expect(service.upload).toHaveBeenCalledWith(expect.objectContaining({ filename: 'original.png' }));
    expect(response).toEqual({
      _id: 'original-id',
      storageUrl: '/uploads/original.png',
      variant: 'original',
      variants: { thumb },
    });
  });

  it('keeps the original response when thumbnail generation is unavailable', async () => {
    const { controller, service } = buildController();
    const original = {
      _id: 'original-id',
      storageUrl: '/uploads/original.png',
      toObject: () => ({ _id: 'original-id', storageUrl: '/uploads/original.png' }),
    };
    service.upload.mockResolvedValue({ original });

    const response = await controller.upload({
      filename: 'original.png',
      originalname: 'product.png',
      mimetype: 'image/png',
      size: 100,
    });

    expect(response).toEqual({
      _id: 'original-id',
      storageUrl: '/uploads/original.png',
      variants: {},
    });
  });

  it('forwards the frame body to the service on PATCH :id/frame', async () => {
    const { controller, service } = buildController();
    service.updateFrame = jest.fn();
    service.updateFrame.mockResolvedValue({ _id: 'photo-id', frame: { fit: 'cover', posX: 30, posY: 70 } });

    const response = await controller.updateFrame('photo-id', { frame: { fit: 'cover', posX: 30, posY: 70 } });

    expect(service.updateFrame).toHaveBeenCalledWith('photo-id', {
      frame: { fit: 'cover', posX: 30, posY: 70 },
    });
    expect(response).toEqual({ _id: 'photo-id', frame: { fit: 'cover', posX: 30, posY: 70 } });
  });
});
