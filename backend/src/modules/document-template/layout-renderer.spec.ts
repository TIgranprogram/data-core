import { blockBackgroundStyle, blockLayoutStyle } from './layout-renderer';

describe('blockLayoutStyle', () => {
  it('compiles normalized geometry to deterministic absolute CSS', () => {
    expect(
      blockLayoutStyle({
        page: 1,
        x: 0.125,
        y: 0.25,
        width: 0.5,
        height: 0.2,
        zIndex: 7,
        rotation: 4,
      }),
    ).toBe('position:absolute;left:12.5%;top:25%;width:50%;z-index:7;height:20%;transform:rotate(4deg)');
  });

  it('returns no style for legacy flow blocks', () => {
    expect(blockLayoutStyle(undefined)).toBe('');
  });

  it('does not emit a height or transform when omitted', () => {
    expect(
      blockLayoutStyle({ page: 1, x: 0, y: 0, width: 1, zIndex: 1, rotation: 0 }),
    ).toBe('position:absolute;left:0%;top:0%;width:100%;z-index:1');
  });
});

describe('blockBackgroundStyle (TZ-DOC-273)', () => {
  it('compiles a 6-digit hex with opacity to a background-color declaration', () => {
    expect(
      blockBackgroundStyle({ blockBackgroundColor: '#ff0080', blockOpacity: 0.5 }),
    ).toBe('background-color:rgba(255, 0, 128, 0.5)');
  });

  it('expands a 3-digit hex and accepts a missing #', () => {
    expect(blockBackgroundStyle({ blockBackgroundColor: '0af' })).toBe(
      'background-color:rgba(0, 170, 255, 0)',
    );
  });

  it('returns no style when settings or color are absent', () => {
    expect(blockBackgroundStyle(undefined)).toBe('');
    expect(blockBackgroundStyle({})).toBe('');
    expect(blockBackgroundStyle({ blockBackgroundColor: '' })).toBe('');
  });

  it('rejects CSS injection, gradients, urls, named colors, and non-hex', () => {
    expect(blockBackgroundStyle({ blockBackgroundColor: 'url(https://evil/x.png)' })).toBe('');
    expect(blockBackgroundStyle({ blockBackgroundColor: 'linear-gradient(red, blue)' })).toBe('');
    expect(blockBackgroundStyle({ blockBackgroundColor: 'red' })).toBe('');
    expect(blockBackgroundStyle({ blockBackgroundColor: '#zzzzzz' })).toBe('');
    expect(blockBackgroundStyle({ blockBackgroundColor: '#12345' })).toBe('');
    expect(blockBackgroundStyle({ blockBackgroundColor: '12; background: red' })).toBe('');
  });

  it('clamps out-of-range and non-finite opacity to [0,1]', () => {
    expect(blockBackgroundStyle({ blockBackgroundColor: '#000000', blockOpacity: 5 })).toBe(
      'background-color:rgba(0, 0, 0, 1)',
    );
    expect(blockBackgroundStyle({ blockBackgroundColor: '#000000', blockOpacity: -2 })).toBe(
      'background-color:rgba(0, 0, 0, 0)',
    );
    expect(
      blockBackgroundStyle({ blockBackgroundColor: '#000000', blockOpacity: Number.NaN }),
    ).toBe('background-color:rgba(0, 0, 0, 0)');
  });
});
