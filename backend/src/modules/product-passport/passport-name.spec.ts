import { Types } from 'mongoose';
import { ProductPassportService } from './product-passport.service';

it.each(['own', 'catalog', 'empty'])('C148: create → повторные GET сохраняют явное имя (%s), обычный черновик следует изделию', async (mode) => {
  const explicit = mode === 'own';
  const pid = new Types.ObjectId();
  const product = { _id: pid, name: 'Модель', passportDefaults: { manualText: ['purpose'] } };
  const state: Record<string, unknown> = {};
  const doc = {
    get _id() { return state._id; },
    get passportCategory() { return state.passportCategory; },
    toObject: () => ({ ...state }),
    set: (set: Record<string, unknown>) => Object.assign(state, set),
    save: async () => doc,
  };
  const query = (value: unknown) => ({ exec: async () => value, setOptions: () => query(value), select: () => query(value), lean: () => query(value), session: () => query(value) });
  const model = {
    create: async (set: Record<string, unknown> | Record<string, unknown>[]) => { Object.assign(state, Array.isArray(set) ? set[0] : set); return Array.isArray(set) ? [doc] : doc; },
    findById: () => query(doc), findOne: () => query(null),
  };
  const cursor = () => ({ toArray: async () => [], sort: () => cursor(), limit: () => cursor() });
  const collection = (name: string) => ({
    findOne: async () => name === 'products' ? product : null,
    find: () => cursor(),
    countDocuments: async () => 0,
    updateOne: async () => ({ matchedCount: 1 }),
  });
  const startSession = async () => ({ withTransaction: async (fn: () => Promise<unknown>) => fn(), endSession: async () => {} });
  const svc = new ProductPassportService(model as never, {} as never, { db: { collection }, collection, startSession } as never);
  await svc.create({ productId: String(pid), supplierOrgId: String(new Types.ObjectId()), ...(mode === 'empty' ? {} : { name: explicit ? 'Название договора' : 'Модель' }) } as never);
  expect(state.manualText).toEqual(explicit ? ['purpose', 'name'] : ['purpose']);
  product.name = 'Новая модель';
  expect(await svc.get(String(state._id))).toMatchObject({ name: explicit ? 'Название договора' : 'Новая модель' });
  expect(await svc.get(String(state._id))).toMatchObject({ name: explicit ? 'Название договора' : 'Новая модель' });
  expect(product.name).toBe('Новая модель');
  const modules = [{ name: 'Рама', qty: 2, dims: '2000×1000', photoId: String(new Types.ObjectId()) }];
  state.modules = modules;
  state.compositionSheet = [{ kind: 'module', word: 'Модуль', label: 'Рама', qty: 2 }];
  expect(await svc.get(String(state._id))).toMatchObject({ compositionPresentation: 'both', modules });
  expect(state).not.toHaveProperty('compositionPresentation'); // GET вычисляет представление, но не пишет marker
  state.modules = [{ name: 'Рама', qty: 2 }];
  expect(await svc.get(String(state._id))).toMatchObject({ compositionPresentation: 'tree', modules: state.modules });
  state.modules = [{ name: 'Другая рама', qty: 2 }];
  expect(await svc.get(String(state._id))).toMatchObject({ compositionPresentation: 'both', modules: state.modules });
  state.status = 'issued';
  expect(await svc.get(String(state._id))).not.toHaveProperty('compositionPresentation');
});
