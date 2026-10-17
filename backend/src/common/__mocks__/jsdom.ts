// Mock for jsdom — minimal stub for e2e tests
export class JSDOM {
  window: Record<string, unknown> = {};
  constructor() {}
}
