import { NotFoundException } from '@nestjs/common';
import { GeneratedDocumentController } from './generated-document.controller';

const user = {
  id: 'user-a',
  username: 'manager-a',
  role: 'manager',
  organizationId: 'org-a',
};

describe('GeneratedDocumentController organization context', () => {
  it('forwards the authenticated user to HTML lookup before sending content', async () => {
    const service = {
      findById: jest.fn().mockResolvedValue({ html: '<p>safe</p>' }),
    };
    const controller = new GeneratedDocumentController(service as never);
    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    await controller.html('doc-a', response as never, user);

    expect(service.findById).toHaveBeenCalledWith('doc-a', user);
    expect(response.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/html; charset=utf-8',
    );
    expect(response.send).toHaveBeenCalledWith('<p>safe</p>');
  });

  it('does not send HTML when scoped lookup rejects a foreign document', async () => {
    const service = {
      findById: jest.fn().mockRejectedValue(new NotFoundException('Not found')),
    };
    const controller = new GeneratedDocumentController(service as never);
    const response = {
      setHeader: jest.fn(),
      send: jest.fn(),
    };

    await expect(controller.html('foreign-doc', response as never, user)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(response.send).not.toHaveBeenCalled();
  });

  it('forwards the authenticated user to generate and delete service boundaries', async () => {
    const service = {
      generate: jest.fn().mockResolvedValue({ _id: 'doc-a' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new GeneratedDocumentController(service as never);

    const dto = {
      name: 'Proposal',
      organizationId: 'org-a',
      contractId: 'contract-a',
    };
    await controller.generate('template-a', dto as never, user);
    await controller.remove('doc-a', user);

    expect(service.generate).toHaveBeenCalledWith(
      'template-a',
      { organizationId: 'org-a', contractId: 'contract-a' },
      { name: 'Proposal' },
      user,
    );
    expect(service.remove).toHaveBeenCalledWith('doc-a', user);
  });
});
