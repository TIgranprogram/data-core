import { mkdtemp, mkdir, writeFile, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Types } from 'mongoose';
import { UploadsOrphanSweepService } from './uploads-orphan-sweep.service';

describe('UploadsOrphanSweepService (TZ-DOC-STUDIO-1801)', () => {
  const blockId = new Types.ObjectId().toString();
  const fileId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const orphanId = 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee';
  const referencedUrl = `/uploads/template-blocks/${blockId}/${fileId}.png`;
  const orphanFile = `${orphanId}.png`;

  let uploadRoot: string;
  let cwd: string;
  let blockModel: { find: jest.Mock };

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'kppdf-upload-sweep-'));
    uploadRoot = join(cwd, 'uploads', 'template-blocks', blockId);
    await mkdir(uploadRoot, { recursive: true });
    await writeFile(join(uploadRoot, `${fileId}.png`), 'referenced');
    const orphanPath = join(uploadRoot, orphanFile);
    await writeFile(orphanPath, 'orphan');
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(orphanPath, old, old);

    blockModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([{ settings: { imageUrl: referencedUrl } }]),
      }),
    };
    jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deletes unreferenced template-block files older than grace period', async () => {
    const service = new UploadsOrphanSweepService(blockModel as never);
    const result = await service.sweep();

    expect(result.deleted).toBe(1);
    await expect(stat(join(uploadRoot, `${fileId}.png`))).resolves.toBeDefined();
    await expect(stat(join(uploadRoot, orphanFile))).rejects.toThrow();
  });
});
